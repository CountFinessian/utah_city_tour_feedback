const crypto = require("crypto");
const fs = require("fs");

const keyId = "QR87LKQS2G";
const issuerId = "5281e175-8658-42a8-a573-14cb1e4de60a";
const privateKey = fs.readFileSync("c:/Users/PC_User/jacob/bedrockDemo/AuthKey_QR87LKQS2G.p8", "utf8");

function base64url(buf) {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function getJwt() {
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
  return tokenPart1 + "." + base64url(sig);
}

async function main() {
  const jwt = getJwt();

  // 1. Check or Register Bundle ID
  console.log("Checking if bundle ID com.utahcity.host exists...");
  const bRes = await fetch("https://api.appstoreconnect.apple.com/v1/bundleIds?filter[identifier]=com.utahcity.host", {
    headers: { Authorization: "Bearer " + jwt },
  });
  const bData = await bRes.json();
  let bundleIdObj = bData.data && bData.data[0];

  if (!bundleIdObj) {
    console.log("Registering bundle ID com.utahcity.host...");
    const regRes = await fetch("https://api.appstoreconnect.apple.com/v1/bundleIds", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + jwt,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          type: "bundleIds",
          attributes: {
            identifier: "com.utahcity.host",
            name: "Utah City Host Debrief",
            platform: "UNIVERSAL",
          },
        },
      }),
    });
    const regData = await regRes.json();
    if (!regData.data) {
      console.error("Failed to register bundle ID:", JSON.stringify(regData, null, 2));
      return;
    }
    bundleIdObj = regData.data;
    console.log("Registered Bundle ID:", bundleIdObj.id);
  } else {
    console.log("Bundle ID already exists:", bundleIdObj.id);
  }

  // 2. Check or Create App
  console.log("Checking if App exists in App Store Connect...");
  const aRes = await fetch("https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=com.utahcity.host", {
    headers: { Authorization: "Bearer " + jwt },
  });
  const aData = await aRes.json();
  let appObj = aData.data && aData.data[0];

  if (!appObj) {
    console.log("Creating App in App Store Connect...");
    const createAppRes = await fetch("https://api.appstoreconnect.apple.com/v1/apps", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + jwt,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          type: "apps",
          attributes: {
            name: "Utah City Host Capture",
            primaryLocale: "en-US",
            sku: "utahcity-host-001",
          },
          relationships: {
            bundleId: {
              data: {
                type: "bundleIds",
                id: bundleIdObj.id,
              },
            },
          },
        },
      }),
    });
    const createAppData = await createAppRes.json();
    if (!createAppData.data) {
      console.error("Failed to create App:", JSON.stringify(createAppData, null, 2));
      return;
    }
    appObj = createAppData.data;
    console.log("Created App:", appObj.id, appObj.attributes.name);
  } else {
    console.log("App already exists:", appObj.id, appObj.attributes.name);
  }

  // 3. Check or Create Provisioning Profile
  console.log("Checking provisioning profiles...");
  const pRes = await fetch(`https://api.appstoreconnect.apple.com/v1/profiles?filter[profileType]=IOS_APP_STORE`, {
    headers: { Authorization: "Bearer " + jwt },
  });
  const pData = await pRes.json();
  console.log("Found profiles:", pData.data ? pData.data.length : 0);

  // Get active distribution certificate ID
  const certRes = await fetch("https://api.appstoreconnect.apple.com/v1/certificates?filter[certificateType]=DISTRIBUTION", {
    headers: { Authorization: "Bearer " + jwt },
  });
  const certData = await certRes.json();
  const cert = certData.data && certData.data[0];
  console.log("Active distribution cert:", cert ? cert.id : "NONE");

  if (cert) {
    console.log("Creating/verifying App Store provisioning profile...");
    const createProfRes = await fetch("https://api.appstoreconnect.apple.com/v1/profiles", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + jwt,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          type: "profiles",
          attributes: {
            name: "Utah City Host AppStore Profile",
            profileType: "IOS_APP_STORE",
          },
          relationships: {
            bundleId: {
              data: {
                type: "bundleIds",
                id: bundleIdObj.id,
              },
            },
            certificates: {
              data: [
                {
                  type: "certificates",
                  id: cert.id,
                },
              ],
            },
          },
        },
      }),
    });
    const createProfData = await createProfRes.json();
    if (createProfData.data) {
      console.log("Successfully created provisioning profile:", createProfData.data.id, createProfData.data.attributes.name);
    } else {
      console.log("Profile creation response:", JSON.stringify(createProfData, null, 2));
    }
  }

  console.log("\nApp Store Connect setup complete!");
}

main().catch(console.error);

