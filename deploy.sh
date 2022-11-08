#!/bin/bash

# The app notices this upgrade-pending file exists after the current game ends,
# deletes it, and exits with code 0. Dokku does not restart the app since it had
# exit code 0 which is what we want. We deploy the app updates which restarts
# the app. We then modify the NGINX config since Dokku does expose a way to update
# this one configuration setting (yet?).

PENDING=/tmp/.upgrade-pending
APP=whatword
DEPLOY_BRANCH=main

ssh whatword.wtf <<EOF
dokku enter $APP web touch $PENDING

while ! dokku enter $APP web cat $PENDING >/dev/null
do
  sleep 1
done

# This will not validate on push since we don't have the limit_req_zone in place yet.
# That has to come after deployment.

rm /home/dokku/$APP/nginx.conf.d/rate_limit.conf
EOF

git push dokku $DEPLOY_BRANCH

NGINX_CONF=/home/dokku/$APP/nginx.conf
NGINX_RATE_LIMIT_CONF=/home/dokku/$APP/nginx.conf.d/rate_limit.conf

ssh whatword.wtf <<EOF
echo "updating keepalive_timeout"
perl -pi -e 's/keepalive_timeout\s+\d+/keepalive_timeout 120/' $NGINX_CONF

echo "updating NGINX config for rate limiting: $NGINX_CONF"
echo 'limit_req_zone \$binary_remote_addr zone=limitreqsbyaddr:20m rate=1r/s;' >/tmp/.conf
echo 'limit_req_status 429;' >>/tmp/.conf
echo '' >>/tmp/.conf
cat $NGINX_CONF >>/tmp/.conf
mv /tmp/.conf $NGINX_CONF

echo "adding rate limit conf: $NGINX_RATE_LIMIT_CONF"
echo 'location /guesses { limit_req zone=limitreqsbyaddr; }' >$NGINX_RATE_LIMIT_CONF
echo 'location /settings { limit_req zone=limitreqsbyaddr; }' >>$NGINX_RATE_LIMIT_CONF

echo "reloading nginx"
service nginx reload
EOF

echo done
