import "jsr:@std/dotenv/load";
// 🔥 디노 전용 초경량 디스코드 라이브러리(harmony) 사용
import { Client, SlashCommandBuilder, Interaction, Embed } from "https://deno.land/x/harmony@v2.9.0/mod.ts";

const DISCORD_TOKEN = Deno.env.get("DISCORD_TOKEN");

const client = new Client();
const scoreDb = new Map();

client.on("ready", async () => {
    console.log(`🤖 벌점/상점 봇이 준비되었습니다!`);

    // 명령어 등록
    const commands = [
        new SlashCommandBuilder()
            .setName("벌점부여")
            .setDescription("유저에게 벌점을 부여하거나 차감합니다. (음수 입력 시 차감)")
            .addOption({
                name: "유저",
                description: "벌점을 조절할 유저",
                type: "USER",
                required: true
            })
            .addOption({
                name: "점수",
                description: "부여할 점수 (지우려면 마이너스 입력)",
                type: "INTEGER",
                required: true
            })
            .addOption({
                name: "사유",
                description: "사유 입력",
                type: "STRING",
                required: true
            }),

        new SlashCommandBuilder()
            .setName("상점부여")
            .setDescription("유저에게 상점을 부여하거나 차감합니다. (음수 입력 시 차감)")
            .addOption({
                name: "유저",
                description: "상점을 조절할 유저",
                type: "USER",
                required: true
            })
            .addOption({
                name: "점수",
                description: "부여할 점수",
                type: "INTEGER",
                required: true
            })
            .addOption({
                name: "사유",
                description: "사유 입력",
                type: "STRING",
                required: true
            }),

        new SlashCommandBuilder()
            .setName("점수통계")
            .setDescription("특정 유저의 상/벌점 내역과 최종 점수를 확인합니다.")
            .addOption({
                name: "유저",
                description: "조회할 유저",
                type: "USER",
                required: true
            })
    ];

    // 디코드 서버 전체에 명령어 강제 동기화
    await client.interactions.commands.all.set(commands);
    console.log("✅ 슬래시 명령어 동기화 완료!");
});

client.on("interactionCreate", async (interaction: Interaction) => {
    if (!interaction.isAutocomplete() && interaction.data) {
        // 시간 초과 에러 방지용 생각 중... 모드 즉시 발동
        await interaction.respond({ type: 5 });

        const targetUserId = interaction.data.options[0].value;
        const targetUser = await client.users.get(targetUserId);

        if (!scoreDb.has(targetUserId)) {
            scoreDb.set(targetUserId, { penaltyPoints: 0, rewardPoints: 0, records: [] });
        }
        const userData = scoreDb.get(targetUserId);

        // --- 벌점 부여 ---
        if (interaction.data.name === "벌점부여") {
            const points = parseInt(interaction.data.options[1].value);
            const reason = interaction.data.options[2].value;

            userData.penaltyPoints += points;
            const typeStr = points < 0 ? "벌점 차감" : "벌점";
            userData.records.push({ type: typeStr, reason, points });

            const currentNet = userData.rewardPoints - userData.penaltyPoints;
            const sign = points > 0 ? `+${points}` : `${points}`;

            const embed = new Embed()
                .setTitle(points < 0 ? "⚙️ 벌점 수정(차감) 알림" : "🚨 벌점 부여 알림")
                .setColor(points < 0 ? "#7F8C8D" : "#FF0000")
                .addField("대상", `<@${targetUserId}>`, true)
                .addField("변동 점수", `${sign}점`, true)
                .addField("사유", reason)
                .addField("누적 점수 현황", `상점: ${userData.rewardPoints}점 | 벌점: ${userData.penaltyPoints}점\n**최종 합산: ${currentNet}점**`);

            await interaction.sendResponse({ embeds: [embed] });
        }

        // --- 상점 부여 ---
        if (interaction.data.name === "상점부여") {
            const points = parseInt(interaction.data.options[1].value);
            const reason = interaction.data.options[2].value;

            userData.rewardPoints += points;
            const typeStr = points < 0 ? "상점 차감" : "상점";
            userData.records.push({ type: typeStr, reason, points });

            const currentNet = userData.rewardPoints - userData.penaltyPoints;
            const sign = points > 0 ? `+${points}` : `${points}`;

            const embed = new Embed()
                .setTitle(points < 0 ? "⚙️ 상점 수정(차감) 알림" : "✨ 상점 부여 알림")
                .setColor(points < 0 ? "#7F8C8D" : "#00FF00")
                .addField("대상", `<@${targetUserId}>`, true)
                .addField("변동 점수", `${sign}점`, true)
                .addField("사유", reason)
                .addField("누적 점수 현황", `상점: ${userData.rewardPoints}점 | 벌점: ${userData.penaltyPoints}점\n**최종 합산: ${currentNet}점**`);

            await interaction.sendResponse({ embeds: [embed] });
        }

        // --- 점수 통계 ---
        if (interaction.data.name === "점수통계") {
            if (userData.records.length === 0) {
                await interaction.sendResponse({ content: `<@${targetUserId}>님은 기록된 상/벌점 내역이 없습니다! 😇` });
                return;
            }

            const netPoints = userData.rewardPoints - userData.penaltyPoints;
            let description = `**상점: ${userData.rewardPoints}점 | 벌점: ${userData.penaltyPoints}점**\n`;
            description += `**🔥 최종 합산 점수: ${netPoints}점**\n\n**[최근 상/벌점 내역]**\n`;

            const recentRecords = userData.records.slice(-5).reverse();
            recentRecords.forEach((record, idx) => {
                let icon = "🍏";
                if (record.type.includes("벌점")) icon = "🍎";
                if (record.type.includes("차감")) icon = "🔧";
                const sign = record.points > 0 ? `+${record.points}` : `${record.points}`;
                description += `${idx + 1}. ${icon} [${record.type}] ${record.reason} (${sign}점)\n`;
            });

            const embed = new Embed()
                .setTitle(`📊 ${targetUser?.username || "유저"}님의 상/벌점 통계`)
                .setColor("#3498DB")
                .setDescription(description);

            await interaction.sendResponse({ embeds: [embed] });
        }
    }
});

// 디노 웹 응답 세팅
Deno.serve((_req) => {
  return new Response("OK", { status: 200 });
});

client.connect(DISCORD_TOKEN, ["GUILDS", "GUILD_MESSAGES"]);
