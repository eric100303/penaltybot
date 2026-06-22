import "jsr:@std/dotenv/load";
import { Client, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from "npm:discord.js";

const DISCORD_TOKEN = Deno.env.get("DISCORD_TOKEN");
const DB_FILE = "./penalty_db.json";

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds
  ] 
});

// 📁 파일 기반의 초간단 데이터베이스 함수들
async function loadData() {
    try {
        const text = await Deno.readTextFile(DB_FILE);
        return JSON.parse(text);
    } catch (_e) {
        // 파일이 없거나 에러 나면 빈 객체 리턴
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
    console.log(`🤖 ${client.user.tag} 벌점 관리 시스템 준비 완료`);

    const commands = [
        new SlashCommandBuilder()
            .setName('벌점부여')
            .setDescription('유저에게 벌점을 부여합니다. (관리자 전용)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(option => 
                option.setName('유저').setDescription('벌점을 받을 유저').setRequired(true))
            .addIntegerOption(option => 
                option.setName('점수').setDescription('부여할 벌점').setRequired(true))
            .addStringOption(option => 
                option.setName('사유').setDescription('벌점 사유').setRequired(true)),
                
        new SlashCommandBuilder()
            .setName('벌점통계')
            .setDescription('특정 유저의 벌점 내역을 확인합니다. (관리자 전용)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(option => 
                option.setName('유저').setDescription('조회할 유저').setRequired(true))
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

    // --- 벌점 부여 명령어 ---
    if (interaction.commandName === '벌점부여') {
        const targetUser = interaction.options.getUser('유저');
        const points = interaction.options.getInteger('점수');
        const reason = interaction.options.getString('사유');

        // 파일에서 최신 데이터 불러오기
        const db = await loadData();
        
        if (!db[targetUser.id]) {
            db[targetUser.id] = { totalPoints: 0, records: [] };
        }
        
        db[targetUser.id].totalPoints += points;
        db[targetUser.id].records.push({ reason, points });

        // 파일에 영구 저장
        await saveData(db);

        const embed = new EmbedBuilder()
            .setTitle('🚨 벌점 부여 알림')
            .setColor(0xFF0000)
            .addFields(
                { name: '대상', value: `<@${targetUser.id}>`, inline: true },
                { name: '부여된 벌점', value: `${points}점`, inline: true },
                { name: '사유', value: reason, inline: false },
                { name: '현재 누적 벌점', value: `${db[targetUser.id].totalPoints}점`, inline: false }
            );

        await interaction.reply({ embeds: [embed] });
    }

    // --- 벌점 통계 명령어 ---
    if (interaction.commandName === '벌점통계') {
        const targetUser = interaction.options.getUser('유저');
        
        // 파일에서 데이터 불러오기
        const db = await loadData();
        const userData = db[targetUser.id];

        if (!userData || userData.totalPoints === 0) {
            await interaction.reply({ content: `<@${targetUser.id}>님은 현재 벌점이 없습니다! 😇`, ephemeral: true });
            return;
        }

        let description = `**총 누적 벌점: ${userData.totalPoints}점**\n\n**[최근 부여 내역]**\n`;
        
        const recentRecords = userData.records.slice(-5).reverse();
        recentRecords.forEach((record, idx) => {
            description += `${idx + 1}. ${record.reason} (+${record.points}점)\n`;
        });

        const embed = new EmbedBuilder()
            .setTitle(`📊 ${targetUser.username}님의 벌점 통계`)
            .setColor(0xFFA500)
            .setDescription(description);

        await interaction.reply({ embeds: [embed] });
    }
});

// 웹 서버 대기 상태 유지
Deno.serve((_req) => {
  return new Response("Penalty Bot is running safely!", { status: 200 });
});

client.login(DISCORD_TOKEN);
