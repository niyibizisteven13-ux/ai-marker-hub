# Implementation Plan - Rename App from `my-app` to `bwenge.space`

Update all configuration files, deployment scripts, GitHub Actions workflows, and guides to use the real app name `bwenge.space` instead of the generic placeholder `my-app`.

## User Review Required

> [!IMPORTANT]
> **Path & Name Updates:** All references to `/var/www/my-app`, PM2 app name `my-app`, and SSH deploy keys will be updated to use `bwenge.space`.

## Open Questions

- None.

## Proposed Changes

### [Deployment & Automation Scripts]

#### [MODIFY] [bootstrap-vps.sh](file:///C:/Users/niyib/Downloads/ai-marker-hub/scripts/bootstrap-vps.sh)
- Update application directory from `/var/www/my-app` to `/var/www/bwenge.space`.
- Update PM2 app name from `my-app` to `bwenge.space`.
- Update Nginx config path from `/etc/nginx/sites-available/my-app` to `/etc/nginx/sites-available/bwenge.space`.

#### [MODIFY] [deploy.sh](file:///C:/Users/niyib/Downloads/ai-marker-hub/scripts/deploy.sh)
- Update `APP_DIR` to `/var/www/bwenge.space`.
- Update PM2 reload target from `my-app` to `bwenge.space`.

#### [MODIFY] [vps-deploy.yml](file:///C:/Users/niyib/Downloads/ai-marker-hub/.github/workflows/vps-deploy.yml)
- Update working directory to `/var/www/bwenge.space`.
- Update PM2 reload/start target to `bwenge.space`.

#### [MODIFY] [ecosystem.config.js](file:///C:/Users/niyib/Downloads/ai-marker-hub/ecosystem.config.js)
- Update PM2 app name to `bwenge.space` and cwd to `/var/www/bwenge.space`.

#### [MODIFY] [deployment_guide.artifact.md](file:///C:/Users/niyib/Downloads/ai-marker-hub/.artifacts/7b20e84e-42d2-40e0-b59c-0fb0dafe8303/deployment_guide.artifact.md)
- Update documentation text to reflect `bwenge.space`.

## Verification Plan

### Automated Tests
- Verify script syntax and file modifications.
