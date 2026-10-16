# Walkthrough - Renamed App to `bwenge.space`

Updated all deployment scripts, configuration files, workflows, and guides to use your real app name and domain: **`bwenge.space`**.

## Changes

### [Configuration & Automation]

#### [MODIFY] [ecosystem.config.js](file:///C:/Users/niyib/Downloads/ai-marker-hub/ecosystem.config.js)
- Renamed PM2 app name from `ai-marker-hub` to `bwenge.space`.

#### [MODIFY] [bootstrap-vps.sh](file:///C:/Users/niyib/Downloads/ai-marker-hub/scripts/bootstrap-vps.sh)
- Updated application directory to `/var/www/bwenge.space`.
- Updated PM2 app name and Nginx config path to `bwenge.space`.
- Set default domain to `bwenge.space`.

#### [MODIFY] [deploy.sh](file:///C:/Users/niyib/Downloads/ai-marker-hub/scripts/deploy.sh)
- Updated remote working directory to `/var/www/bwenge.space` and PM2 reload target to `bwenge.space`.

#### [MODIFY] [vps-deploy.yml](file:///C:/Users/niyib/Downloads/ai-marker-hub/.github/workflows/vps-deploy.yml)
- Updated GitHub Actions workflow working directory and PM2 commands to target `bwenge.space`.

## Verification Results

### Automated Verification
- Verified all shell scripts and configuration files for syntax correctness.
