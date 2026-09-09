#!/bin/sh
# Write environment variables to /etc/network/device.env so SSH shell sessions inherit them
mkdir -p /etc/network
echo "DEVICE_HOSTNAME=${DEVICE_HOSTNAME:-sw-classroom-01}" > /etc/network/device.env
echo "CONFIG_FILE=${CONFIG_FILE:-/etc/network/classroom_switch.cfg}" >> /etc/network/device.env
chmod -R 777 /etc/network

exec /usr/sbin/sshd -D -e
