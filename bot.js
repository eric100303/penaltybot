import "jsr:@std/dotenv/load";
import { Client, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from "npm:discord.js";

const DISCORD_TOKEN = Deno.env.get("DISCORD_TOKEN");

// 인텐트 설정 (슬래시 명령어 위주라면 Guilds만 있어도 충분해)
const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds
  ] 
});

// 🔥 [변경점] Deno 내장 데이터베이스(KV) 창고 열기
const kv = await Deno.openKv();

client.once('ready', async () => {
    console.log(`🤖 ${client.user.tag} 벌점 관리 시스템 준비 완료`);

    // ---------------------------------------------------------
    // 1. 슬래시 명령어 정의 및 동기화
    // ---------------------------------------------------------
    const commands = [
        new SlashCommandBuilder()
            .setName('벌점부여')
            .setDescription('유저에게 벌점을 부여합니다. (관리자 전용)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // 관리자 전용 권한 설정
            .addUserOption(option => 
                option.setName('유저').setDescription('벌점을 받을 유저').setRequired(true))
            .addIntegerOption(option => 
                option.setName('점수').setDescription('부여할 벌점').setRequired(true))
            .addStringOption(option => 
                option.setName('사유').setDescription('벌점 사유').setRequired(true)),
                
        new SlashCommandBuilder()
            .setName('벌점통계')
            .setDescription('특정 유저의 벌점 내역을 확인합니다. (관리자 전용)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // 관리자 전용 권한 설정
            .addUserOption(option => 
                option.setName('유저').setDescription('조회할 유저').setRequired(true))
    ].map(command => command.toJSON());

    try {
        // 봇이 켜질 때 디스코드에 슬래시 명령어를 등록해
        await client.application.commands.set(commands);
        console.log('✅ 슬래시 명령어 동기화 완료!');
    } catch (error) {
        console.error('명령어 등록 중 오류 발생:', error);
    }
});

// ---------------------------------------------------------
// 2. 명령어 입력 시 반응 처리
// ---------------------------------------------------------
client.on('interactionCreate', async interaction => {
    // 슬래시 명령어가 아니면 무시
    if (!interaction.isChatInputCommand()) return;

    // --- 벌점 부여 명령어 ---
    if (interaction.commandName === '벌점부여') {
        const targetUser = interaction.options.getUser('유저');
        const points = interaction.options.getInteger('점수');
        const reason = interaction.options.getString('사유');

        // 🔥 [변경점] 메모리가 아닌 DB(KV)에서 기존 유저 데이터 읽어오기
        const kvRes = await kv.get(["penalties", targetUser.id]);
        let userData = kvRes.value;

        // DB에 데이터가 없으면 새로 만들기
        if (!userData) {
            userData = { totalPoints: 0, records: [] };
        }
        
        // 벌점 및 사유 기록
        userData.totalPoints += points;
        userData.records.push({ reason, points });

        // 🔥 [변경점] 업데이트된 데이터를 DB(KV)에 영구 저장하기
        await kv.set(["penalties", targetUser.id], userData);

        // 예쁜 임베드 메시지 생성
        const embed = new EmbedBuilder()
            .setTitle('🚨 벌점 부여 알림')
            .setColor(0xFF0000) // 빨간색
            .addFields(
                { name: '대상', value: `<@${targetUser.id}>`, inline: true },
                { name: '부여된 벌점', value: `${points}점`, inline: true },
                { name: '사유', value: reason, inline: false },
                { name: '현재 누적 벌점', value: `${userData.totalPoints}점`, inline: false }
            );

        await interaction.reply({ embeds: [embed] });
    }

    // --- 벌점 통계 명령어 ---
    if (interaction.commandName === '벌점통계') {
        const targetUser = interaction.options.getUser('유저');
        
        // 🔥 [변경점] DB(KV)에서 해당 유저 데이터 조회하기
        const kvRes = await kv.get(["penalties", targetUser.id]);
        const userData = kvRes.value;

        // 벌점이 없는 경우
        if (!userData || userData.totalPoints === 0) {
            // ephemeral: true 를 주면 명령어를 친 사람한테만 메시지가 보여
            await interaction.reply({ content: `<@${targetUser.id}>님은 현재 벌점이 없습니다! 😇`, ephemeral: true });
            return;
        }

        let description = `**총 누적 벌점: ${userData.totalPoints}점**\n\n**[최근 부여 내역]**\n`;
        
        // 최근 5개 기록만 역순으로 출력
        const recentRecords = userData.records.slice(-5).reverse();
        recentRecords.forEach((record, idx) => {
            description += `${idx + 1}. ${record.reason} (+${record.points}점)\n`;
        });

        const embed = new EmbedBuilder()
            .setTitle(`📊 ${targetUser.username}님의 벌점 통계`)
            .setColor(0xFFA500) // 주황색
            .setDescription(description);

        await interaction.reply({ embeds: [embed] });
    }
});

// 웹 서버 유지용
Deno.serve((_req) => {
  return new Response("Penalty Bot is running!", { status: 200 });
});

client.login(DISCORD_TOKEN);