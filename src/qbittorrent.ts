
const QBIT_URL = process.env.QBIT_URL || "http://debridav:8080";
const QBIT_USER = process.env.QBIT_USER || "admin";
const QBIT_PASS = process.env.QBIT_PASS || "adminadmin";

let authCookie: string | null = null;

async function login() {
  console.log(`Logging into qBittorrent at ${QBIT_URL}...`);
  const params = new URLSearchParams();
  params.append("username", QBIT_USER);
  params.append("password", QBIT_PASS);

  try {
    const response = await fetch(`${QBIT_URL}/api/v2/auth/login`, {
        method: "POST",
        body: params,
        headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Login failed: ${response.status} ${text}`);
    }

    // qBittorrent returns SID in Set-Cookie
    const cookieHeader = response.headers.get("set-cookie");
    if (cookieHeader) {
        const sid = cookieHeader.split(';')[0];
        authCookie = sid;
    } else {
        // Sometimes "Ok." is returned but cookie is set in browser.
        // In server-to-server, we need the header.
        // If the response text is "Ok.", it means success.
        const text = await response.text();
        if (text === "Ok.") {
            // If no set-cookie header (unlikely for login), we can't persist auth easily unless the library handles it.
            // But fetch usually requires manual cookie handling.
            // Let's log a warning if no cookie found but "Ok.".
            console.warn("Login returned Ok. but no Set-Cookie header found.");
        } else {
             throw new Error("Login failed: No cookie received");
        }
    }
  } catch (e) {
      console.error("qBittorrent login error:", e);
      throw e;
  }
}

async function ensureAuth() {
    if (!authCookie) {
        await login();
    }
}

export function getHashFromMagnet(magnet: string): string | null {
    const match = magnet.match(/xt=urn:btih:([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
}

export async function addTorrent(magnet: string, subfolder: string, name: string) {
    await ensureAuth();
    const formData = new FormData();
    formData.append("urls", magnet);
    formData.append("savepath", `/data/${subfolder}`);
    if (name) {
        formData.append("rename", name);
    }
    // formData.append("root_folder", "true"); 

    console.log(`Adding torrent: ${name} to /data/${subfolder}`);

    let response = await fetch(`${QBIT_URL}/api/v2/torrents/add`, {
        method: "POST",
        headers: {
            "Cookie": authCookie || ""
        },
        body: formData
    });

    if (response.status === 403) {
        console.log("Auth expired, relogging...");
        await login();
        response = await fetch(`${QBIT_URL}/api/v2/torrents/add`, {
            method: "POST",
            headers: {
                "Cookie": authCookie || ""
            },
            body: formData
        });
    }

    const text = await response.text();
    if (!response.ok || text === "Fails.") {
        throw new Error(`Failed to add torrent: ${text}`);
    }
    
    return true;
}

export async function getTorrentStatus(hash: string) {
    await ensureAuth();
    let response = await fetch(`${QBIT_URL}/api/v2/torrents/info?hashes=${hash}`, {
        headers: {
            "Cookie": authCookie || ""
        }
    });

    if (response.status === 403) {
         await login();
         response = await fetch(`${QBIT_URL}/api/v2/torrents/info?hashes=${hash}`, {
            headers: {
                "Cookie": authCookie || ""
            }
        });
    }

    if (!response.ok) throw new Error("Failed to get status");
    
    const data: any = await response.json();
    if (Array.isArray(data) && data.length > 0) {
        const torrent = data[0];
        // Calculate percentage if not explicitly provided or check "progress" (0-1)
        const progress = torrent.progress * 100;
        const isDownloaded = progress === 100 || torrent.state === "uploading" || torrent.state === "pausedUP" || torrent.state === "queuedUP" || torrent.state === "completed";
        
        return {
            found: true,
            name: torrent.name,
            state: torrent.state,
            progress: progress,
            isDownloaded
        };
    }
    return { found: false };
}

