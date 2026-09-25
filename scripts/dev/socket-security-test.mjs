import { io } from "socket.io-client";

const URL = "http://127.0.0.1:4001";
const results = [];

function connect(cookie, label) {
  return new Promise((resolve) => {
    const s = io(URL, {
      path: "/realtime",
      transports: ["websocket"],
      extraHeaders: cookie ? { Cookie: cookie } : {},
      reconnection: false,
      timeout: 6000,
    });
    const done = (r) => { results.push({ test: label, ...r }); s.close(); resolve(s); };
    s.on("connect_error", (e) => done({ connected: false, error: e.message }));
    s.on("ready", (d) => resolve(Object.assign(s, { _ready: d })));
    setTimeout(() => done({ connected: false, error: "timeout" }), 7000);
  });
}

function sub(s, channel) {
  return new Promise((resolve) => {
    s.emit("subscribe", channel, (r) => resolve(r));
    setTimeout(() => resolve({ ok: false, reason: "no ack" }), 3000);
  });
}

const cookie = process.argv[2];

// 1. no cookie
await connect(null, "çerezsiz bağlantı");
// 2. garbage cookie
await connect("cleo_session=totally-made-up-value", "sahte çerez");

// 3. valid cookie
const s = await connect(cookie, "geçerli çerez");
if (s && s._ready) {
  results.push({ test: "geçerli çerez", connected: true, user: s._ready.user.name, role: s._ready.user.roleId });
  results.push({ test: "presence aboneliği", ...(await sub(s, "presence")) });
  results.push({ test: "calls:live", ...(await sub(s, "calls:live")) });
  results.push({ test: "uydurma kanal", ...(await sub(s, "secret:everything")) });
  results.push({ test: "kapsam dışı şube (leads:location:99)", ...(await sub(s, "leads:location:99")) });
  results.push({ test: "kapsam içi şube (leads:location:1)", ...(await sub(s, "leads:location:1")) });
  const presence = await new Promise((r) => { s.on("presence", r); setTimeout(() => r(null), 7000); });
  results.push({ test: "presence verisi geldi", ok: !!presence, toplam: presence?.total });
  s.close();
}

console.log(JSON.stringify(results, null, 1));
process.exit(0);
