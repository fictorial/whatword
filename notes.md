# WhatWord.wtf Notes

## Domain

The domain name is whatword.wtf which I registered with Google Domains.

https://domains.google.com/registrar/whatword.wtf/dns#nameservers

Configure the domain on Google Domains to use nameservers

- ns1.digitalocean.com
- ns2.digitalocean.com
- ns3.digitalocean.com

## Dokku and Digital Ocean

This project uses Dokku on Digital Ocean for "production".

- https://dokku.com/
- https://digitalocean.com/
- https://dokku.com/docs/getting-started/install/digitalocean/

Create a new droplet with Dokku as "Digital Ocean 1-click app":

- https://cloud.digitalocean.com/droplets/324918001/resize?i=747fbb

A $4/mo basic droplet with 10GB space was initially chosen.

## SSH

A SSH key was already configured in Digital Ocean. The 1-click installation
installed this to the "Droplet" (VPS) for the root user.

    local$ cat ~/.ssh/id_rsa.pub

Added to local ~/.ssh/config:

    Host whatword.wtf
      User root
      Hostname whatword.wtf
      RequestTTY yes

This enables:

    local$ ssh whatword.wtf

## Droplet Upgrades

Upgrade server system software packages and Ubuntu release:

    remote# apt-get update
    remote# apt-get upgrade -y
    remote# apt-get dist-upgrade
    remote# do-release-upgrade

This failed with:

    No space left on device

Resize the Droplet in the DigitalOcean control panel:

https://cloud.digitalocean.com/droplets/324918001/resize

The droplet now has 1GB RAM, 25GB disk, and 1TB transfer for $6/mo.

Power the droplet back on.

    local$ ssh whatword.wtf

    Usage of /:   39.3% of 24.05GB

Continue to upgrade:

    remote# apt --fix-broken install
    remote# apt-get update
    remote# apt-get upgrade -y
    remote# apt-get dist-upgrade
    remote# apt autoremove
    remote# reboot
    remote# do-release-upgrade

Ignore the alternate SSHd on :1022 and just accept all defaults.

This will probably reboot the server.

    local$ ssh whatword.wtf

After the upgrade:

    Usage of /:   44.4% of 24.05GB

## Create Dokku App

Note: multiple apps can be deployed to Dokku on the same server.

    remote# dokku apps:create whatword

## Tell Dokku the Domain for the App

    remote# dokku domains:set whatword whatword.wtf

## Configure Let's Encrypt

    remote# dokku plugin:install https://github.com/dokku/dokku-letsencrypt.git
    remote# dokku config:set --global DOKKU_LETSENCRYPT_EMAIL=<your email>
    remote# dokku letsencrypt:enable whatword
    remote# dokku letsencrypt:cron-job --add

## Timeout

Since we can have long EventSource connections without any data read, it could timeout.
Thus, we want this to be at least as long as the game itself. The client will reconnect
automatically but it looks funny when that happens in the middle of a game (where nothing
is happening, sure, but still...).

    remote# dokku nginx:set whatword proxy-read-timeout 180s

Another thing to consider is keepalive_timeout. This is not configurable via Dokku
as of Nov 2022. Thus, you modify the NGINX config and reload it.

    remote# sed -i 's/keepalive_timeout   70/keepalive_timeout   120/' /home/dokku/whatword/nginx.conf
    remote# service nginx reload

This can be part of a deploy script too.

## Code

Github can host the code but it's not required as the code can be pushed
to Dokku directly.

    local$ git remote add origin git@github.com:fictorial/whatword.git
    local$ git remote add dokku dokku@whatword.wtf:whatword

## Configure Environment Variables

    remote# dokku config:set whatword NAME=VALUE ... NAME=VALUE
    remote# dokku config:unset whatword NAME ... NAME
    remote# dokku config:show whatword

## Database (unused)

WhatWord doesn't use persistence but might eventually. Here's how:

    remote# dokku plugin:install https://github.com/dokku/dokku-postgres.git
    remote# dokku postgres:create whatword-pg
    remote# dokku postgres:link whatword-pg whatword

This will set environment variable:

    DATABASE_URL

## Redis (unused)

    remote# dokku plugin:install https://github.com/dokku/dokku-redis.git redis
    remote# dokku redis:create whatword-redis
    remote# dokku redis:link whatword-redis whatword

This will set environment variable:

    REDIS_URL

## Persistent Volumes (unused)

Dokku does not retain filesystem contents on deployments. A "persistent volume"
does however. This mounts a directory to "/storage" for the app to use.

    remote# mkdir -p /var/lib/dokku/data/storage/whatword-storage
    remote# chown -R 32767:32767 /var/lib/dokku/data/storage/whatword-storage
    remote# dokku storage:mount whatword /var/lib/dokku/data/storage/whatword-storage

Restart the app:

    remote# dokku ps:restart whatword

See what is happening with storage:

    remote# dokku storage:report

## Deployments

We don't require zero-downtime upgrades though since clients remain connected
for as long as possible, reconnecting with exponential backoff delays on each
consecutive reconnection failure. Thus, if we simple push and restart
immediately, we're OK.

    remote# dokku checks:disable whatword

The trick however is that we want to wait until the current game ends.
To signal to WhatWord to _not_ start a new game:

    remote# touch /tmp/.whatword-upgrade-pending

WhatWord will check for this file and NOT start a new game. Instead, it will
write file

    /tmp/.whatword-upgrade-ready

When you see this, the latest code can be pushed to the Dokku git remote
and the temporary signal files can be removed:

    remote# rm -f /tmp/.whatword-upgrade-ready /tmp/.whatword-upgrade-pending

    local$ git push dokku main  # or main perhaps

This can of course be wrapped in a NPM package.json script if desired:

    local$ curl https://whatword.wtf/version

    local$ npm run deploy

    local$ curl https://whatword.wtf/version

Put this in `package.json` in the `scripts` section:

```js
"deploy-init": "ssh whatword.wtf -- touch /tmp/.whatword-upgrade-pending",
"deploy-wait": "ssh whatword.wtf -- \"bash -c 'while [ ! -f /tmp/.whatword-upgrade-ready ]; do sleep 1; done'\"",
"deploy-push": "git push dokku main",
"deploy-deinit": "ssh whatword.wtf -- rm -f /tmp/.whatword-upgrade-ready /tmp/.whatword-upgrade-pending",
"deploy": "npm run deploy-deinit && npm run deploy-init && npm run deploy-wait && npm run deploy-push"
```

### Github Actions (unused)

On push to github, the app can be deployed from there to our server if we wanted
via Github Actions.

The usefulness of this is debatable in our case since we can deploy directly to Dokku.

Add to the repo settings the SSH private key as a secret named SSH_PRIVATE_KEY.

Then add to the repo a config file in `.github/workflows/deploy.yml`:

```yaml
---
name: 'deploy'

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Cloning repo
        uses: actions/checkout@v2
        with:
          fetch-depth: 0

      - name: Push to dokku
        uses: dokku/github-action@master
        with:
          git_remote_url: 'ssh://dokku@whatword.wtf/whatword'
          ssh_private_key: ${{ secrets.SSH_PRIVATE_KEY }}
```

## Tail Logs

    remote# dokku logs whatword -t

See https://dokku.com/docs/deployment/logs/
