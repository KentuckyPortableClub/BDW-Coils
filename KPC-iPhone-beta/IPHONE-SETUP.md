# KPC on the iPhone — setup

There is no KPC app in the App Store, so on an iPhone or iPad the KPC app is a **web page in Safari**.
The radio stays plugged into your **Windows PC**, and the iPhone runs it **through the KPC app on the PC**.

## What works on the iPhone

| Works | Does not |
|---|---|
| Frequency, mode, bands, 🎛 More Controls, meters | Plugging a radio into the iPhone (Safari has no USB or Bluetooth radio control) |
| 🔧 Tune (asks first), the SWR guard (on the PC) | Sound while the screen is locked or you are in another app (Apple's rule for web pages) |
| Hearing the radio, the voice keyer, the PC's FT8 | Talking on the plain home address (way 1); talking needs way 2 (Tailscale) |
| Talking (hold TALK), with **way 2** below | |
| The log and the spots | |

There are **two ways** to open it. Way 1 takes two minutes. Way 2 takes about fifteen minutes once, and then does everything, at home or away.

---

## Before either way: on the PC

1. Install the newest KPC app on the PC (the nightly build, or **Run workflow** on GitHub → Actions → Build the app).
2. Plug in the radio and connect it in the KPC app as usual.
3. In the KPC app: **STATION → REMOTE LINK → 📡 LET MY PHONE IN**.
   The card shows the PC's **addresses** (like `192.168.1.25`) and a **6-digit pair code**.
4. If Windows asks *"Allow KPC on networks?"* say **Allow** on **Private networks**.

---

### Finding the PC's address
- In the KPC app on the PC: **STATION → REMOTE LINK → 📡 LET MY PHONE IN** lists it (like `192.168.1.25`).
- Or Windows: **Settings → Network & internet → Wi-Fi** (or Ethernet) → your network's properties → **IPv4 address**.
- Or press the Windows key, type **cmd**, open Command Prompt and type `ipconfig`: use the **IPv4 Address** line.
- For Tailscale: the PC's name in the Tailscale app on the iPhone, or `tailscale serve status` on the PC.

---

## Way 1 — at home, no extra apps (listen + run the radio, no talking)

1. The iPhone must be on the **same Wi-Fi** as the PC.
2. On the iPhone, open **Safari** and type the PC's address with `:8731/phone/` on the end, for example:
   ```
   http://192.168.1.25:8731/phone/
   ```
   (Use the address the PC's REMOTE LINK card shows, not this example.)
3. The page says **"KPC on the iPhone"**. Tap **OK, PAIR NOW**.
4. **PC ADDRESS** is already filled in. Type the **6-digit pair code** from the PC, tap **🔗 CONNECT TO THE PC**.
5. On the PC, a box pops up: tap **✓ APPROVE**.
6. The iPhone opens the **📡 REMOTE** screen. Tap **🔊 LISTEN** to hear the radio.
7. Optional: Safari **Share ⬆ → Add to Home Screen** → it gets the KPC logo and opens like an app.

On this plain address Safari will not allow the microphone, so **TALK says it needs the Tailscale address**. Everything else works.

---

## Way 2 — Tailscale (everything, talking too, at home or away)

Tailscale is a free app that links your own devices together privately. Only *your* devices can reach the PC; nothing is opened to the internet.

### A. On the PC (once)
1. Go to **tailscale.com/download**, install Tailscale for Windows, and **sign in** (Google, Microsoft or Apple account is fine).
2. Open the Tailscale admin page **login.tailscale.com/admin/dns** and turn on:
   - **MagicDNS**
   - **HTTPS Certificates**
3. On the PC press the **Windows key**, type **cmd**, open **Command Prompt**, and type exactly:
   ```
   tailscale serve --bg 8731
   ```
   - If it shows a `login.tailscale.com` link, open it, approve, and it finishes by itself.
   - If it says *access denied*: close it, right-click **Command Prompt → Run as administrator**, and type it again.
4. It prints your PC's private web address, for example:
   ```
   https://brandon-pc.tail1234.ts.net
   ```
   **Write that down.** (You can always see it again with `tailscale serve status`.)
   This keeps working after a restart. To turn it off some day: `tailscale serve reset`.

### B. On the iPhone (once)
1. Install **Tailscale** from the App Store and **sign in with the same account** as the PC. Turn it **on** (it asks to add a VPN: Allow).
2. Open **Safari** and go to your PC's address with `/phone/` on the end:
   ```
   https://brandon-pc.tail1234.ts.net/phone/
   ```
3. Tap **OK, PAIR NOW**, type the **6-digit code** from the PC, **🔗 CONNECT TO THE PC**, then **✓ APPROVE** on the PC.
4. On the **📡 REMOTE** screen: **🔊 LISTEN** to hear. Hold **🎙 HOLD TO TALK** to talk. The first time, Safari asks for the **microphone**: tap **Allow**.
5. Safari **Share ⬆ → Add to Home Screen**. From now on, tap the KPC icon.

Away from home: just make sure **Tailscale is on** on the iPhone (and the PC is on with the KPC app open and LET MY PHONE IN on).

---

## The old iPhone beta website (retired Nov 18 2026)

The `KPC-iPhone-beta` folder on the BDW-Coils site used to hold a copy of the app (0.8.0, Nov 8). It was retired on Nov 18 2026:
it could no longer connect to a current PC (since 0.9.0 the PC asks for a newer pairing), and the page the PC hands out (ways 1 and 2
above) is always the same version as the PC's app. The address now shows a short page that points here.

If the old page is on your Home Screen, delete that icon and add the PC's address (way 1 or way 2) instead.

---

## If something is wrong

| Problem | Try |
|---|---|
| Safari says it can't connect to `http://…:8731/phone/` | Same Wi-Fi? PC address right (STATION → REMOTE LINK)? LET MY PHONE IN on? Windows firewall: allow KPC on private networks. |
| The Tailscale address does not open | Tailscale **on** on the iPhone? Same account on both? On the PC run `tailscale serve status`: it should show `proxy http://127.0.0.1:8731`. |
| Paired, but no sound | Tap **🔊 LISTEN** again (Safari needs a tap to start sound). Is the iPhone's side switch on silent? Turn the volume up. |
| The sound stops | The screen locked or you switched apps (Apple's rule). Come back and tap **🔊 LISTEN**. The page keeps the screen awake while it is open. |
| TALK says it needs the Tailscale address | You are on way 1 (plain address). Use way 2. |
| TALK: no microphone | iPhone **Settings → Safari → Microphone → Ask/Allow**, then reload the page. |
| The sound is quiet | Raise **VOLUME** on the REMOTE screen (up to 10×). The iPhone plays from the loud speaker except while you hold TALK. |
| Pair code refused | Codes change: use the one showing on the PC now. Each phone needs **✓ APPROVE** on the PC once. |

Questions or reports: use **📝 WORKS ON MY RADIO** or the app's report button, and say it was the **iPhone** page.
