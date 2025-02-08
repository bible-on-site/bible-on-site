IP address: 64.23.161.137
Connection via SSH key & passkey only
How to setup from scratch:
1. Create a new server in the DigitalOcean dashboard
2. Add your SSH key to the server
3. SSH into the server
4. Run the following commands:
```bash
snap install core; sudo snap refresh core
snap install --classic certbot
ln -s /snap/bin/certbot /usr/bin/certbot
ufw allow 443
ufw allow 80
```
# TODO: migrate everything from the old windows server then can assign the .com domain here as well
```bash
# certbot certonly --standalone -d xn--febl3a.co.il -d www.xn--febl3a.co.il -d api.xn--febl3a.co.il -d xn--febl3a.com -d www.xn--febl3a.com -d api.xn--febl3a.com
certbot certonly --standalone -d xn--febl3a.co.il -d www.xn--febl3a.co.il -d api.xn--febl3a.co.il
apt update
apt install nginx
ufw allow 'Nginx Full'
apt install geoip-database
install libnginx-mod-http-geoip
```
# put router.conf in /etc/nginx/conf.d/
```bash
# validate using:
```bash
nginx -t
```
# reload using:
```bash
systemctl reload nginx
```
