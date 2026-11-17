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

## Picture, screen and sound quality
Four levels, chosen per student by how many are live, how big the tiles are, and your choice in Settings → Picture quality (Auto, Sharper, Lighter):

| Level | When | Face | Shared screen |
|---|---|---|---|
| high | the student you zoom in on | 1280x720, 24 pictures/s, up to 1 Mbit/s | the whole screen at 1920x1080, 10/s, up to 2.5 Mbit/s |
| mid | a few students on big tiles | 640x480, 12/s, 350 kbit/s | 960x540, 5/s, 900 kbit/s (text is readable) |
| low | the usual grid | 320x240, 8/s, 120 kbit/s | 480x270, 3/s |
| tiny | more than 48 live | 160x120, 4/s, 40 kbit/s | 240x135, 2/s |

- The student's phone captures small and only captures big (720p, a faster screen) while a lecturer is zoomed in on it, so it stays cheap for them the rest of the time. A shared screen is marked as text ("detail"): it keeps its size and sharpness rather than smoothness.
- **Listening.** Press Listen on a tile (or in the zoom view) to hear one student. Five bars move with their voice, and the zoom view has a volume slider. Sound is one channel, Opus, at most 32 kbit/s, with lost packets repaired and nothing sent while silent (the lecturer's answer carries these settings, so the student's phone sends that way). Nothing is heard unless the lecturer allows listening and presses Listen, and the student sees a notice.
- **Zoom view** shows what you are really getting (size, pictures per second, bits per second), a "Weak connection" mark when pictures are being lost, and a Full screen button.
- Each tile that should be live says "Connecting live..." and, after about 25 s (longer in a big room), "Picture only" when live video could not start for that student; the small picture is shown instead.

Measured in headless Chrome (loopback, fake camera, a simulated full-HD screen): tiny 160x120 at 4/s, low 320x240 at 8/s, mid 640x480 at 12/s, high 1280x720 at 20/s for the face and 1920x1080 at 10/s for the screen (about 1.4 Mbit/s). The student's phone sent Opus with `usedtx=1;useinbandfec=1;stereo=0;maxaveragebitrate=32000`. Real phones, networks and microphones were not measured.

## A relay (TURN) for students on mobile data
Live video goes straight from each student to the lecturer. On home and campus Wi-Fi that works with only a STUN server. Students on mobile data (many carriers share one address between many phones) or behind strict school firewalls need a TURN relay, or their tile shows the small picture ("Picture only"). The live room warns the lecturer when the server has no relay. To set one up: run coturn with `use-auth-secret` and set `MYSEB_TURN_URLS` and `MYSEB_TURN_SECRET` (the same secret) in the server's environment (see myseb/docs/BWENGE.md). A relay carries every relayed student's video, so size it for the students it will carry: 500 students at the tiny level is about 20 Mbit/s in and 20 Mbit/s out.
