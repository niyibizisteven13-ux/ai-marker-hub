# Task List: Push to GitHub & Deploy to Fly.io

- [ ] Stage and commit all git changes (auth, email sender, test_smtp.js, etc.)
- [ ] Push changes to GitHub (`git push origin main`)
- [ ] Verify Fly.io app configuration and database connection secrets (`DATABASE_URL`)
- [ ] Run build test (`npm run build`)
- [ ] Deploy server to Fly.io (`fly deploy`)
- [ ] Verify server health and endpoint availability (`/api/health`, `fly status`)
- [ ] Create walkthrough artifact
