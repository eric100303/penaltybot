import "jsr:@std/dotenv/load";

const DISCORD_TOKEN = Deno.env.get("DISCORD_TOKEN");
const scoreDb = new Map();

// 🤖 디스코드 게이트웨이(통신망) 직접 연결용 설정
let socket;
let sequence = null;
let sessionId = null;

function connectGateway() {
    socket = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");

    socket.onopen = () => {
        console.log("🔌 디스코드 게이트웨이 직접 연결 시작!");
        // 봇 인증 및 로그인 요청 수동 전송
        const identifyPayload = {
            op: 2,
            d: {
                token: DISCORD_TOKEN,
                intents: 33280, // Guilds + Guild Messages + Message Content 통신망 강제 개방
                properties: { os: "linux", browser: "deno", device: "deno" }
            }
        };
        socket.send(JSON.stringify(identifyPayload));
    };

    socket.onmessage = async (event) => {
        const payload = JSON.parse(event.data);
        const { op, t, d, s } = payload;

        if (s) sequence = s;

        // Heartbeat 주기적 신호 처리 (생존 신고)
        if (op === 10) {
            const interval = d.heartbeat_interval;
            setInterval(() => {
                socket.send(JSON.stringify({ op: 1, d: sequence }));
            }, interval);
        }

        // 💬 채팅 메시지가 들어왔을 때 처리
        if (t === "MESSAGE_CREATE") {
            const { content, author, channel_id, id } = d;

            // 봇이 쓴 글은 무시
            if (author.bot) return;

            // 1. !벌점 유저ID 점수 사유
            if (content.startsWith("!벌점")) {
                const parts = content.split(" ");
                if (parts.length < 4) {
                    await sendMessage(channel_id, "❌ 형식을 맞춰줘! 사용법: `!벌점 유저ID 점수 사유` (예: `!벌점 12345 3 지각`)");
                    return;
                }
                const targetId = parts[1].replace(/[^0-9]/g, ""); // 멘션이나 ID에서 숫자만 추출
                const points = parseInt(parts[2]);
                const reason = parts.slice(3).join(" ");

                if (isNaN(points)) return;

                initUser(targetId);
                const userData = scoreDb.get(targetId);
                userData.penaltyPoints += points;
                userData.records.push({ type: "벌점", reason, points });

                const currentNet = userData.rewardPoints - userData.penaltyPoints;
                const sign = points > 0 ? `+${points}` : `${points}`;

                await sendEmbed(channel_id, "🚨 벌점 부여 알림", "#FF0000", 
                    `**대상:** <@${targetId}>\n**변동 점수:** ${sign}점\n**사유:** ${reason}\n\n**누적 현황**\n상점: ${userData.rewardPoints}점 | 벌점: ${userData.penaltyPoints}점\n**최종 합산: ${currentNet}점**`
                );
            }

            // 2. !상점 유저ID 점수 사유
            if (content.startsWith("!상점")) {
                const parts = content.split(" ");
                if (parts.length < 4) {
                    await sendMessage(channel_id, "❌ 형식을 맞춰줘! 사용법: `!상점 유저ID 점수 사유` (예: `!상점 12345 5 과제제출`)");
                    return;
                }
                const targetId = parts[1].replace(/[^0-9]/g, "");
                const points = parseInt(parts[2]);
                const reason = parts.slice(3).join(" ");

                if (isNaN(points)) return;

                initUser(targetId);
                const userData = scoreDb.get(targetId);
                userData.rewardPoints += points;
                userData.records.push({ type: "상점", reason, points });

                const currentNet = userData.rewardPoints - userData.penaltyPoints;
                const sign = points > 0 ? `+${points}` : `${points}`;

                await sendEmbed(channel_id, "✨ 상점 부여 알림", "#00FF00", 
                    `**대상:** <@${targetId}>\n**변동 점수:** ${sign}점\n**사유:** ${reason}\n\n**누적 현황**\n상점: ${userData.rewardPoints}점 | 벌점: ${userData.penaltyPoints}점\n**최종 합산: ${currentNet}점**`
                );
            }

            // 3. !통계 유저ID
            if (content.startsWith("!통계")) {
                const parts = content.split(" ");
                if (parts.length < 2) {
                    await sendMessage(channel_id, "❌ 사용법: `!통계 유저ID` 또는 `!통계 @유저멘션` ");
                    return;
                }
                const targetId = parts[1].replace(/[^0-9]/g, "");

                initUser(targetId);
                const userData = scoreDb.get(targetId);

                if (userData.records.length === 0) {
                    await sendMessage(channel_id, `<@${targetId}>님은 기록된 상/벌점 내역이 없습니다! 😇`);
                    return;
                }

                const netPoints = userData.rewardPoints - userData.penaltyPoints;
                let desc = `**상점: ${userData.rewardPoints}점 | 벌점: ${userData.penaltyPoints}점**\n`;
                desc += `**🔥 최종 합산 점수: ${netPoints}점**\n\n**[최근 상/벌점 내역]**\n`;

                const recent = userData.records.slice(-5).reverse();
                recent.forEach((record, idx) => {
                    let icon = "🍏";
                    if (record.type.includes("벌점")) icon = "🍎";
                    const sign = record.points > 0 ? `+${record.points}` : `${record.points}`;
                    desc += `${idx + 1}. ${icon} [${record.type}] ${record.reason} (${sign}점)\n`;
                });

                await sendEmbed(channel_id, `📊 상/벌점 통계`, "#3498DB", desc);
            }
        }
    };

    socket.onclose = () => {
        console.log("❌ 연결 끊김, 1초 뒤 재연결 시도...");
        setTimeout(connectGateway, 1000);
    };
}

function initUser(userId) {
    if (!scoreDb.has(userId)) {
        scoreDb.set(userId, { penaltyPoints: 0, rewardPoints: 0, records: [] });
    }
}

// 📨 순수 HTTP 요청으로 메시지 쏘기 (라이브러리 미사용)
async function sendMessage(channelId, text) {
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bot ${DISCORD_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content
