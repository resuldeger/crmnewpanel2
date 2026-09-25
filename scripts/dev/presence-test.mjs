import { io } from "socket.io-client";
const [cookie, label] = process.argv.slice(2);
const s = io("http://127.0.0.1:4001", { path: "/realtime", transports: ["websocket"],
  extraHeaders: { Cookie: cookie }, reconnection: false });
s.on("connect_error", (e) => { console.log(label, "BAĞLANAMADI:", e.message); process.exit(1); });
s.on("ready", (d) => { console.log(label, "bağlandı:", d.user.name, d.user.roleId, "scopeAll:", d.scopeAll); s.emit("subscribe", "presence", (r) => console.log(label, "abonelik:", JSON.stringify(r))); });
s.on("presence", (p) => {
  console.log(`${label}: toplam=${p.total} tanımlı=${p.identified}`);
  console.log("  şube :", p.byStudio.map(x => `${x.slug}=${x.count}`).join(" ") || "—");
  console.log("  kaynak:", p.bySource.map(x => `${x.source}=${x.count}`).join(" ") || "—");
  console.log("  adım  :", p.byStep.map(x => `${x.step}=${x.count}`).join(" ") || "—");
  s.close(); process.exit(0);
});
setTimeout(() => { console.log(label, "veri gelmedi"); process.exit(1); }, 9000);
