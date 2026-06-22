import "jsr:@std/dotenv/load";
import { connect } from "https://deno.land/x/redis@v0.34.0/mod.ts"; // Redis 드라이버 추가

const DISCORD_TOKEN = Deno.env.get("DISCORD_TOKEN");
const REDIS_URL = Deno.env.get("REDIS_URL"); // 레일웨이가 자동으로 넣어줄 DB 주소

// 1. Redis 연결 설정
let redis;
try {
    if (REDIS_URL) {
        redis = await connect({ url: REDIS_URL });
        console.log("💾 Redis DB 연결 완료!");
    } else {
        console.log("⚠️ REDIS_URL이 없어 로컬 메모리 모드로 동작합니다.");
    }
} catch (e) {
    console.error("❌ Redis 연결 실패:", e);
}

// 헬퍼 함수: DB에서 유저 데이터 가져오기
async function getUser(userId) {
    if (redis) {
        const data = await redis.get(`user:${userId}`);
        return data ? JSON.parse(data) : { penaltyPoints: 0, rewardPoints: 0, records: [] };
    }
    return { penaltyPoints: 0, rewardPoints: 0, records: [] };
}

// 헬퍼 함수: DB에 유저 데이터 저장하기
async function saveUser(userId, userData) {
    if (redis) {
        await redis.set(`user:${userId}`, JSON.stringify(userData));
    }
}

let socket;
let sequence = null;

function connectGateway() {
    socket = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");

    socket.onopen = () => {
        console.log("🔌 디스코드 게이트웨이 직접 연결 시작!");
        const identifyPayload = {
            op: 2,
            d: {
                token: DISCORD_TOKEN,
                intents: 33280, 
                properties: { os: "linux", browser: "deno", device: "deno" }
            }
        };
        socket.send(JSON.stringify(identifyPayload));
    };

    socket.onmessage = async (event) => {
        const payload = JSON.parse(event.data);
        const { op, t, d, s } = payload;

        if (s) sequence = s;

        if (op === 10) {
            const interval = d.heartbeat_interval;
            setInterval(() => {
                socket.send(JSON.stringify({ op: 1, d: sequence }));
            }, interval);
        }

        if (t === "MESSAGE_CREATE") {
            const { content, author, channel_id } = d;
            if (author.bot) return;

            // 1. !벌점
            if (content.startsWith("!벌점")) {
                const parts = content.split(" ");
                if (parts.length < 4) {
                    await sendMessage(channel_id, "❌ 사용법: `!벌점 @유저멘션 점수 사유` (예: `!벌점 @홍길동 3 지각`)");
                    return;
                }
                const targetId = parts[1].replace(/[^0-9]/g, ""); 
                const points = parseInt(parts[2]);
                const reason = parts.slice(3).join(" ");

                if (isNaN(points)) return;

                // DB에서 데이터 로드 후 수정 및 저장
                const userData = await getUser(targetId);
                userData.penaltyPoints += points;
                userData.records.push({ type: "벌점", reason, points });
                await saveUser(targetId, userData);

                const currentNet = userData.rewardPoints - userData.penaltyPoints;
                const sign = points > 0 ? `+${points}` : `${points}`;

                await sendEmbed(channel_id, "🚨 벌점 부여 알림", "#FF0000", 
                    `**대상:** <@${targetId}>\n**변동 점수:** ${sign}점\n**사유:** ${reason}\n\n**누적 현황**\n상점: ${userData.rewardPoints}점 | 벌점: ${userData.penaltyPoints}점\n**최종 합산: ${currentNet}점**`
                );
            }

            // 2. !상점
            if (content.startsWith("!상점")) {
                const parts = content.split(" ");
                if (parts.length < 4) {
                    await sendMessage(channel_id, "❌ 사용법: `!상점 @유저멘션 점수 사유` (예: `!상점 @홍길동 5 과제`)");
                    return;
                }
                const targetId = parts[1].replace(/[^0-9]/g, "");
                const points = parseInt(parts[2]);
                const reason = parts.slice(3).join(" ");

                if (isNaN(points)) return;

                // DB에서 데이터 로드 후 수정 및 저장
                const userData = await getUser(targetId);
                userData.rewardPoints += points;
                userData.records.push({ type: "상점", reason, points });
                await saveUser(targetId, userData);

                const currentNet = userData.rewardPoints - userData.penaltyPoints;
                const sign = points > 0 ? `+${points}` : `${points}`;

                await sendEmbed(channel_id, "✨ 상점 부여 알림", "#00FF00", 
                    `**대상:** <@${targetId}>\n**변동 점수:** ${sign}점\n**사유:** ${reason}\n\n**누적 현황**\n상점: ${userData.rewardPoints}점 | 벌점: ${userData.penaltyPoints}점\n**최종 합산: ${currentNet}점**`
                );
            }

            // 3. !통계
            if (content.startsWith("!통계")) {
                const parts = content.split(" ");
                if (parts.length < 2) {
                    await sendMessage(channel_id, "❌ 사용법: `!통계 @유저멘션` ");
                    return;
                }
                const targetId = parts[1].replace(/[^0-9]/g, "");

                const userData = await getUser(targetId);

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
        setTimeout(connectGateway, 1000);
    };
}

// 기존 HTTP 서버 구동 (Railway가 포트를 열어서 봇이 살아있는지 체크하는 용도)
Deno.
