# Live room at scale (up to 500 students live at once)

"Live at once" in Live room → Settings offers 12, 24, 48, 100, 250 and 500 students. Only the tiles on screen are live, so the number is a ceiling; the grid size decides how many fit (use Tile size → Tiny, or zoom the browser out with Ctrl and minus, to see hundreds at once).

What makes 500 possible
- **Lighter pictures when many are live.** Up to 48 live students each picture is half size (about 120 kbit/s, 8 pictures per second). Beyond 48 the grid switches to *tiny* (a quarter size, about 40 kbit/s, 4 per second): about 20 Mbit/s for 500. The one student you zoom in on is always full size. (`src/utils/liveQuality.ts`)
- **A gradual start.** Students are asked to start 6 at a time, 0.35 s apart, so 500 do not all answer in the same second (about 30 s for 500).
- **Room for the set-up messages.** A lecturer's inbox in the exam server holds 6,000 messages (500 students x about 10 each); it was 300. (`MYSEB_SIGNAL_CAP`)
- **Their own request limits.** The site allowed a signed-in person 1,500 requests and an anonymous address 600 per 15 minutes. A room with hundreds of live students, or a class on one school network, reaches that at once. Live-room paths now have their own limits: the lecturer's room 40,000 per 15 minutes (`LIVE_ROOM_MAX`), and each student's MySEB session 4,000 (`STUDENT_LIVE_MAX`), counted per session, not per network address. Everything else keeps the old limit. (`production/rateLimiter.js`)
- **Tiny tiles** show the picture and the name only; everything else is one tap away.

What was measured (headless Chrome, 4 vCPU / 16 GB machine, loopback, same tiny settings and gradual start): one lecturer page received 500 live pictures at once, all 500 showed at about 4 pictures per second, and the page stayed responsive (worst timer delay 19 ms). That is a loopback test: real students add network delay and loss, and the lecturer's connection must carry about 20-25 Mbit/s for 500.

Limits to know
- Chrome allows about 500 connections per page, so 500 is the most (one connection per live student).
- A weak computer or a Wi-Fi connection will struggle well before 500. Advice: Chrome, a laptop with 16 GB, wired internet. If it gets slow, choose fewer or set View to Pictures (no live video, unlimited).
- Zoom and Listen still work for one student at a time.
