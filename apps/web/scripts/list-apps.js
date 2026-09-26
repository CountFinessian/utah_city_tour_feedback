const crypto = require("crypto");
const fs = require("fs");

const keyId = "QR87LKQS2G";
const issuerId = "5281e175-8658-42a8-a573-14cb1e4de60a";
const privateKey = fs.readFileSync("c:/Users/PC_User/jacob/bedrockDemo/AuthKey_QR87LKQS2G.p8", "utf8");

function base64url(buf) {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

const header = { alg: "ES256", kid: keyId, typ: "JWT" };
const now = Math.floor(Date.now() / 1000);
const payload = {
  iss: issuerId,
  exp: now + 1200,
  aud: "appstoreconnect-v1",
};

const tokenPart1 = base64url(Buffer.from(JSON.stringify(header))) + "." + base64url(Buffer.from(JSON.stringify(payload)));
const sign = crypto.createSign("SHA256");
sign.update(tokenPart1);
const sig = sign.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
const jwt = tokenPart1 + "." + base64url(sig);

async function check() {
  const res = await fetch("https://api.appstoreconnect.apple.com/v1/apps", {
    headers: { Authorization: "Bearer " + jwt },
  });
  const data = await res.json();
  console.log("Apps found:", JSON.stringify(data.data, null, 2));
}

check().catch(console.error);

