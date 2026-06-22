import "jsr:@std/dotenv/load";
import { Client, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from "npm:discord.js";

const DISCORD_TOKEN = Deno.env.get("DISCORD_TOKEN");
const DB_FILE = "./penalty_db.json";

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds
  ] 
});

async function loadData() {
    try {
        const text = await Deno.readTextFile(DB_FILE);
        return JSON.parse(text);
    } catch (_e) {
        return {};
    }
}

async function saveData(data) {
    try {
        await Deno.writeTextFile(DB_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("데이터 저장 실패:", e);
    }
}

client.once('ready', async () => {
    console.log(`🤖 ${client.user.tag} 상/벌점 통합 관리 시스템 준비 완료`);

    const commands = [
        new SlashCommandBuilder()
            .setName('벌점부여')
            .setDescription('유저에게 벌점을 부여합니다. (관리자 전용)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(option => option.setName('유저').setDescription('벌점을 받을 유저').setRequired(true))
            .addIntegerOption(option => option.setName('점수').setDescription('부여할 벌점').setRequired(true))
            .addStringOption(option => option.setName('사유').setDescription('벌점 사유').setRequired(true)),
            
        new SlashCommandBuilder()
            .setName('상점부여')
            .setDescription('유저에게 상점을 부여합니다. (관리자 전용)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(option => option.setName('유저').setDescription('상점을 받을 유저').setRequired(true))
            .addIntegerOption(option => option.setName('점수').setDescription('부여할 상점').setRequired(true))
            .addStringOption(option => option.setName('사유').setDescription('상점 사유').setRequired(true)),
                
        new SlashCommandBuilder()
            .setName('점수통계')
            .setDescription('특정 유저의 상/벌점 내역과 최종 점수를 확인합니다. (관리자 전용)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(option => option.setName('유저').setDescription('조회할 유저').setRequired(true))
    ].map(command => command.toJSON());

    try {
        await client.application.commands.set(commands);
        console.log('✅ 슬래시 명령어 동기화 완료!');
    } catch (error) {
        console.error('명령어 등록 중 오류 발생:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const db = await loadData();

    const initUser = (userId) => {
        if (!db[userId]) {
            db[userId] = { penaltyPoints: 0, rewardPoints: 0, records: [] };
        }
        if (db[userId].totalPoints !== undefined && db[userId].penaltyPoints === undefined) {
            db[userId].penaltyPoints = db[userId].totalPoints;
            db[userId].rewardPoints = 0;
            delete db[userId].totalPoints;
        }
    };

    if (interaction.commandName === '벌점부여') {
        const targetUser = interaction.options.getUser('유저');
        const points = interaction.options.getInteger('점수');
        const reason = interaction.options.getString('사유');

        initUser(targetUser.id);
        
        db[targetUser.id].penaltyPoints += points;
        db[targetUser.id].records.push({ type: '벌점', reason, points });

        await saveData(db);

        const currentNet = db[targetUser.id].rewardPoints - db[targetUser.id].penaltyPoints;

        const embed = new EmbedBuilder()
            .setTitle('🚨 벌점 부여 알림')
            .setColor(0xFF0000)
            .addFields(
                { name: '대상', value: `<@${targetUser.id}>`, inline: true },
                { name: '부여된 벌점', value: `+${points}점`, inline: true },
                { name: '사유', value: reason, inline: false },
                { name: '누적 점수 현황', value: `상점: ${db[targetUser.id].rewardPoints}점 | 벌점: ${db[targetUser.id].penaltyPoints}점\n**최종 합산: ${currentNet}점**`, inline: false }
            );

        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === '상점부여') {
        const targetUser = interaction.options.getUser('유저');
        const points = interaction.options.getInteger('점수');
        const reason = interaction.options.getString('사유');

        initUser(targetUser.id);
        
        db[targetUser.id].rewardPoints += points;
        db[targetUser.id].records.push({ type: '상점', reason, points });

        await saveData(db);

        const currentNet = db[targetUser.id].rewardPoints - db[targetUser.id].penaltyPoints;

        const embed = new EmbedBuilder()
            .setTitle('✨ 상점 부여 알림')
            .setColor(0x00FF00)
            .addFields(
                { name: '대상', value: `<@${targetUser.id}>`, inline: true },
                { name: '부여된 상점', value: `+${points}점`, inline: true },
                { name: '사유', value: reason, inline: false },
                { name: '누적 점수 현황', value: `상점: ${db[targetUser.id].rewardPoints}점 | 벌점: ${db[targetUser.id].penaltyPoints}점\n**최종 합산: ${currentNet}점**`, inline: false }
            );

        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === '점수통계') {
        const targetUser = interaction.options.getUser('유저');
        initUser(targetUser.id);
        
        const userData = db[targetUser.id];

        if (userData.records.length === 0) {
            await interaction.reply({ content: `<@${targetUser.id}>님은 기록된 상/벌점 내역이 없습니다! 😇`, ephemeral: true });
            return;
        }

        const netPoints = userData.rewardPoints - userData.penaltyPoints;
        let description = `**상점: ${userData.rewardPoints}점 | 벌점: ${userData.penaltyPoints}점**\n`;
        description += `**🔥 최종 합산 점수: ${netPoints}점**\n\n**[최근 상/벌점 내역]**\n`;

        const recentRecords = userData.records.slice(-5).reverse();
        recentRecords.forEach((record, idx) => {
            const icon = record.type === '상점' ? '🍏' : '🍎';
            description += `${idx + 1}. ${icon} [${record.type}] ${record.reason} (+${record.points}점)\n`;
        });

        const embed = new EmbedBuilder()
            .setTitle(`📊 ${targetUser.username}님의 상/벌점 통계`)
            .setColor(0x3498DB)
            .setDescription(description);

        await interaction.reply({ embeds: [embed] });
    }
});

Deno.serve((_req) => {
  return new Response("Penalty & Reward Bot is running safely!", { status: 200 });
});

client.login(DISCORD_TOKEN);
