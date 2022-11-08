#!/bin/bash

# The app notices this upgrade-pending file exists after the current game ends,
# deletes it, and exits with code 0. Dokku does not restart the app since it had
# exit code 0 which is what we want. We deploy the app updates which restarts
# the app. We then modify the NGINX config since Dokku does expose a way to update
# this one configuration setting (yet?).

PENDING=/tmp/.upgrade-pending
APP=whatword
DEPLOY_BRANCH=main
NGINX_CONF=/home/dokku/$APP/nginx.conf
NGINX_RATE_LIMIT_CONF=/home/dokku/$APP/nginx.conf.d/rate_limit.conf

ssh whatword.wtf <<EOF
dokku enter $APP web touch $PENDING

while ! dokku enter $APP web cat $PENDING >/dev/null
do
  sleep 1
done

rm -f $NGINX_RATE_LIMIT_CONF
EOF

git push dokku $DEPLOY_BRANCH

ssh whatword.wtf <<EOF
perl -pi -e 's/keepalive_timeout\s+\d+/keepalive_timeout 120/' $NGINX_CONF

# TODO this seems correct (conf validates) but throwing an error for some reason:
#   nginx: [emerg] zero size shared memory zone "limitreqsbyaddr"
#
# echo 'limit_req_zone \$binary_remote_addr zone=limitreqsbyaddr:20m rate=1r/s;' >/tmp/.conf
# echo 'limit_req_status 429;' >>/tmp/.conf
# echo '' >>/tmp/.conf
# cat $NGINX_CONF >>/tmp/.conf
# mv /tmp/.conf $NGINX_CONF
#
# echo 'location /guesses { limit_req zone=limitreqsbyaddr; }' >$NGINX_RATE_LIMIT_CONF
# echo 'location /settings { limit_req zone=limitreqsbyaddr; }' >>$NGINX_RATE_LIMIT_CONF

service nginx reload
EOF

echo done
