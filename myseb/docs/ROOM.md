# MySEB Room

Open `/room/` on the MySEB server (normally `/myseb/room/` on the embedded deployment) to host from a laptop or phone. Room has its own web app manifest, host dashboard, database tables and RM- codes. The MySEB desktop and mobile apps open the participant viewer from **Room** on the start screen. Exam codes and LR- codes use their existing entry points.

Create a room, set a duration and optionally schedule its start. Share the RM- code or display the QR. Participants enter the code in the updated MySEB app. The QR opens the web entry point with the code filled in. A normal web browser can host a room. Joining as a participant requires a compatible MySEB client. The host credential stays in the creating browser profile. Use a private profile on a shared host computer.

Choose one HTTPS site, selected sites, or open HTTPS browsing. An allowed site is an exact origin (scheme, host and port). External sign-in and embedded frames can require additional approved sites. Test the activity before the session. The policy controls navigation in the activity viewer; a school that also needs to prevent launching other applications must configure its managed devices separately.

Save additional links in the activity library. Publishing new settings or launching a saved activity replaces the active page on connected clients. Tell participants to submit or save their work first. Third-party services retain their own submission and recovery behavior.

Participants see the monitoring notice before joining. Their device polls about every 4–6 seconds, reports the last applied policy revision, and retains the active navigation restriction if the server becomes unreachable. The dashboard marks a session as reconnecting after 30 seconds without a report. Acknowledgement means the viewer applied the policy. It does not confirm a form submission or a participant's attention.

The host can answer help requests, approve an individual exit, end the whole room or export a participant status report. Disconnected devices pick up releases and policy changes on reconnection. The viewer also has a local expiry timer. Closed rooms cannot admit new participants. Room data is eligible for automatic cleanup one day after the scheduled end.

The backend regression test simulates 500 sessions, a room-wide policy change, individual exit approval, and the original exam and LiveRoom entry points. Run the MySEB backend test command with PostgreSQL available.
