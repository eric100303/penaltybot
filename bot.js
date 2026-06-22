import "jsr:@std/dotenv/load";
import { Client, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from "npm:discord.js";

const DISCORD_TOKEN = Deno.env.get("DISCORD_TOKEN");

// 🔑 모든 인텐트 권한을 강제로 활성화해서 통신 뚫기
const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ] 
});

const scoreDb = new Map();

client.once('ready', async () => {
    console.log(`🤖 ${client.user.tag} 시스템 완벽 준비 완료`);

    const commands = [
        new SlashCommandBuilder()
            .setName('벌점부여')
            .setDescription('유저에게 벌점을 부여하거나 차감합니다. (음수 입력 시 차감)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(option => option.setName('유저').setDescription('벌점을 조절할 유저').setRequired(true))
            .addIntegerOption(option => option.setName('점수').setDescription('부여할 점수 (예: 3 또는 -3)').setRequired(true))
            .addStringOption(option => option.setName('사유').setDescription('사유 입력').setRequired(true)),
            
        new SlashCommandBuilder()
            .setName('상점부여')
            .setDescription('유저에게 상점을 부여하거나 차감합니다. (음수 입력 시 차감)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(option => option.setName('유저').setDescription('상점을 조절할 유저').setRequired(true))
            .addIntegerOption(option => option.setName('점수').setDescription('부여할 점수 (예: 5 또는 -5)').setRequired(true))
            .addStringOption(option => option.setName('사유').setDescription('사유 입력').setRequired(true)),
                
        new SlashCommandBuilder()
            .setName('점수통계')
            .setDescription('특정 유저의 상/벌점 내역과 최종 점수를 확인합니다. (관리자 전용)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(option => option.setName('유저').setDescription('조회할 유저').setRequired(true))
    ].map(command => command.toJSON());

    try {
        await client.application.commands.set(commands);
        console.log('✅ 슬래시 명령어 동기화 완벽 완료!');
    } catch (error) {
        console.error('명령어 등록 중 오류 발생:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // ⏱️ 디스코드가 삐지기 전에 무조건 생각 중 상태로 고정
    try {
        await interaction.deferReply();
    } catch (e) {
        console.error("deferReply 에러:", e);
        return;
    }

    const targetUser = interaction.options.getUser('유저');
    
    if (!scoreDb.has(targetUser.id)) {
        scoreDb.set(targetUser.id, { penaltyPoints: 0, rewardPoints: 0, records: [] });
    }
    const userData = scoreDb.get(targetUser.id);

    // --- 벌점 부여/차감 ---
    if (interaction.commandName === '벌점부여') {
        const points = interaction.options.getInteger('점수');
        const reason = interaction.options.getString('사유');

        userData.penaltyPoints += points;
        const typeStr = points < 0 ? '벌점 차감' : '벌점';
        userData.records.push({ type: typeStr, reason, points });

        const currentNet = userData.rewardPoints - userData.penaltyPoints;
        const sign = points > 0 ? `+${points}` : `${points}`;

        const embed = new EmbedBuilder()
            .setTitle(points < 0 ? '⚙️ 벌점 수정(차감) 알림' : '🚨 벌점 부여 알림')
            .setColor(points < 0 ? 0x7F8C8D : 0xFF0000)
            .addFields(
                { name: '대상', value: `<@${targetUser.id}>`, inline: true },
                { name: '변동 점수', value: `${sign}점`, inline: true },
                { name: '사유', value: reason, inline: false },
                { name: '누적 점수 현황', value: `상점: ${userData.rewardPoints}점 | 벌점: ${userData.penaltyPoints}점\n**최종 합산: ${currentNet}점**`, inline: false }
            );

        await interaction.editReply({ embeds: [embed] });
    }

    // --- 상점 부여/차감 ---
    if (interaction.commandName === '상점부여') {
        const points = interaction.options.getInteger('점수');
        const reason = interaction.options.getString('사유');

        userData.rewardPoints += points;
        const typeStr = points < 0 ? '상점 차감' : '상점';
        userData.records.push({ type: typeStr, reason, points });

        const currentNet = userData.rewardPoints - userData.penaltyPoints;
        const sign = points > 0 ? `+${points}` : `${points}`;

        const embed = new EmbedBuilder()
            .setTitle(points < 0 ? '⚙️ 상점 수정(차감) 알림' : '✨ 상점 부여 알림')
            .setColor(points < 0 ? 0x7F8C8D : 0x00FF00)
            .addFields(
                { name: '대상', value: `<@${targetUser.id}>`, inline: true },
                { name: '변동 점수', value: `${sign}점`, inline: true },
                { name: '사유', value: reason, inline: false },
                { name: '누적 점수 현황', value: `상점: ${userData.rewardPoints}점 | 벌점: ${userData.penaltyPoints}점\n**최종 합산: ${currentNet}점**`, inline: false }
            );

        await interaction.editReply({ embeds: [embed] });
    }

    // --- 통합 점수 통계 ---
    if (interaction.commandName === '점수통계') {
        if (userData.records.length === 0) {
            await interaction.editReply({ content: `<@${targetUser.id}>님은 기록된 상/벌점 내역이 없습니다! 😇` });
            return;
        }

        const netPoints = userData.rewardPoints - userData.penaltyPoints;
        let description = `**상점: ${userData.rewardPoints}점 | 벌점: ${userData.penaltyPoints}점**\n`;
        description += `**🔥 최종 합산 점수: ${netPoints}점**\n\n**[최근 상/벌점 내역]**\n`;
        
        const recentRecords = userData.records.slice(-5).reverse();
        recentRecords.forEach((record, idx) => {
            let icon = '🍏';
            if (record.type.includes('벌점')) icon = '🍎';
            if (record.type.includes('차감')) icon = '🔧';
            
            const sign = record.points > 0 ? `+${record.points}` : `${
