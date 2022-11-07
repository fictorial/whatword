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

git push dokku $DEPLOY_BRANCH

perl -pi -e 's/keepalive_timeout\s+\d+/keepalive_timeout 120/' /home/dokku/$APP/nginx.conf

service nginx reload
EOF
