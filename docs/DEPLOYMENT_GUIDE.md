# Deployment Guide - Lottery Booking System

## Pre-Deployment Checklist

### Security
- [ ] Change admin credentials in `.env`
- [ ] Generate strong JWT_SECRET (min 32 characters)
- [ ] Update MONGODB_URI to production database
- [ ] Enable MongoDB authentication
- [ ] Set NODE_ENV=production
- [ ] Remove debug logging
- [ ] Set secure CORS origins
- [ ] Enable HTTPS (SSL/TLS)

### Testing
- [ ] Run all unit tests
- [ ] Run integration tests
- [ ] Perform load testing
- [ ] Test all user flows
- [ ] Verify time restrictions
- [ ] Check error handling

### Documentation
- [ ] Update API endpoints in docs
- [ ] Document deployment process
- [ ] Create runbook for operations
- [ ] Document monitoring strategy

---

## Deployment Options

### Option 1: Heroku Deployment

#### Backend Deployment

1. **Install Heroku CLI**
   ```bash
   npm install -g heroku
   ```

2. **Login to Heroku**
   ```bash
   heroku login
   ```

3. **Create Heroku App**
   ```bash
   cd backend
   heroku create lottery-booking-api
   ```

4. **Set Environment Variables**
   ```bash
   heroku config:set MONGODB_URI=your_production_mongodb_uri
   heroku config:set JWT_SECRET=your_strong_secret_key
   heroku config:set NODE_ENV=production
   ```

5. **Deploy**
   ```bash
   git push heroku main
   ```

6. **View Logs**
   ```bash
   heroku logs --tail
   ```

#### Frontend Deployment (Netlify)

1. **Build Frontend**
   ```bash
   cd frontend
   npm run build
   ```

2. **Deploy to Netlify**
   - Connect GitHub repository
   - Build command: `npm run build`
   - Publish directory: `build`
   - Set environment variables in Netlify UI

3. **Update API Base URL**
   ```env
   REACT_APP_API_URL=https://lottery-booking-api.herokuapp.com/api
   ```

---

### Option 2: AWS Deployment

#### Backend on EC2

1. **Launch EC2 Instance**
   - AMI: Ubuntu 20.04 LTS
   - Instance type: t2.micro (free tier)
   - Security group: Allow 5000, 80, 443

2. **Install Node.js and MongoDB**
   ```bash
   sudo apt update
   sudo apt install nodejs npm mongodb-server
   sudo systemctl start mongod
   ```

3. **Deploy Application**
   ```bash
   git clone your-repo
   cd backend
   npm install
   npm start
   ```

4. **Setup Reverse Proxy (Nginx)**
   ```bash
   sudo apt install nginx
   ```

   Create `/etc/nginx/sites-available/lottery`:
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       location / {
           proxy_pass http://localhost:5000;
       }
   }
   ```

5. **Enable SSL with Let's Encrypt**
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```

#### Frontend on S3 + CloudFront

1. **Build Frontend**
   ```bash
   npm run build
   ```

2. **Upload to S3**
   - Create S3 bucket
   - Upload `build` folder
   - Enable static website hosting

3. **Setup CloudFront**
   - Create distribution
   - Set S3 bucket as origin
   - Enable GZIP compression
   - Set cache headers

---

### Option 3: Docker Deployment

#### Create Dockerfile for Backend

```dockerfile
FROM node:16-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 5000

CMD ["node", "server.js"]
```

#### Create docker-compose.yml

```yaml
version: '3.8'

services:
  mongodb:
    image: mongo:5.0
    environment:
      MONGO_INITDB_DATABASE: lottery_booking
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db

  backend:
    build: ./backend
    ports:
      - "5000:5000"
    environment:
      MONGODB_URI: mongodb://mongodb:27017/lottery_booking
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
    depends_on:
      - mongodb

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      REACT_APP_API_URL: http://localhost:5000/api

volumes:
  mongodb_data:
```

#### Deploy with Docker Compose

```bash
docker-compose up -d
```

---

### Option 4: DigitalOcean Deployment

1. **Create Droplet**
   - OS: Ubuntu 20.04 LTS
   - Size: Basic ($6/month)

2. **Initial Setup**
   ```bash
   ssh root@your_droplet_ip
   apt update && apt upgrade -y
   apt install -y nodejs npm mongodb-server
   ```

3. **Deploy Application**
   ```bash
   git clone your-repo
   cd backend
   npm install
   npm start &
   ```

4. **Setup Nginx**
   See AWS Nginx section above

5. **Setup PM2 for Process Management**
   ```bash
   npm install -g pm2
   pm2 start server.js --name lottery-api
   pm2 startup
   pm2 save
   ```

---

## Environment Configuration

### Production .env Template

```env
# Server
PORT=5000
NODE_ENV=production

# Database
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/lottery_booking?retryWrites=true&w=majority

# Security
JWT_SECRET=your_very_long_random_secret_key_min_32_characters
JWT_EXPIRY=24h

# Admin
ADMIN_USERNAME=secure_admin_username
ADMIN_PASSWORD=secure_admin_password

# CORS
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Email (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Monitoring
SENTRY_DSN=your_sentry_dsn_for_error_tracking
```

---

## Database Backup Strategy

### MongoDB Backup Script

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/backups/mongodb"
DATE=$(date +%Y%m%d_%H%M%S)

mongodump --uri "mongodb+srv://user:pass@cluster.mongodb.net/lottery_booking" \
  --out "$BACKUP_DIR/backup_$DATE"

# Keep only last 30 days
find "$BACKUP_DIR" -type d -mtime +30 -exec rm -rf {} \;

echo "Backup completed: $BACKUP_DIR/backup_$DATE"
```

### Automated Backup (Cron)

```bash
# Backup daily at 2 AM
0 2 * * * /path/to/backup.sh >> /var/log/mongodb-backup.log 2>&1
```

---

## Monitoring & Logging

### Application Monitoring

1. **PM2 Monitoring**
   ```bash
   npm install -g pm2-plus
   pm2 plus
   ```

2. **Sentry for Error Tracking**
   ```bash
   npm install @sentry/node
   ```

3. **New Relic APM**
   ```bash
   npm install newrelic
   ```

### Log Management

```bash
# View logs with PM2
pm2 logs lottery-api

# Save logs to file
pm2 logs lottery-api > api.log

# Use ELK Stack for centralized logging
```

### Monitoring Checklist

- [ ] CPU usage < 80%
- [ ] Memory usage < 85%
- [ ] Database response time < 100ms
- [ ] Error rate < 0.1%
- [ ] Uptime > 99.9%
- [ ] API response time < 200ms

---

## Performance Optimization

### Backend Optimization

1. **Enable GZIP Compression**
   ```javascript
   const compression = require('compression');
   app.use(compression());
   ```

2. **Implement Caching**
   ```bash
   npm install redis
   ```

3. **Database Indexing**
   ```javascript
   // Ensure indexes
   userSchema.index({ username: 1 }, { unique: true });
   lotteryEntrySchema.index({ uniqueCode: 1 }, { unique: true });
   ```

4. **Connection Pooling**
   - Set `maxPoolSize` in MongoDB connection

### Frontend Optimization

1. **Code Splitting**
   ```javascript
   const AdminDashboard = React.lazy(() => import('./components/AdminDashboard'));
   ```

2. **Image Optimization**
   - Compress images
   - Use WebP format
   - Lazy load images

3. **Build Optimization**
   ```bash
   npm run build -- --analyze
   ```

---

## Scaling Strategy

### Horizontal Scaling

1. **Load Balancer**
   - Nginx as reverse proxy
   - Or AWS Application Load Balancer

2. **Database Replication**
   - MongoDB Replica Set
   - Automatic failover

3. **Caching Layer**
   - Redis for session storage
   - Cache frequently accessed data

### Vertical Scaling

1. **Increase server resources**
   - More CPU cores
   - More RAM
   - SSD storage

---

## Rollback Plan

### If Deployment Fails

1. **Stop Current Deployment**
   ```bash
   pm2 stop lottery-api
   ```

2. **Revert to Previous Version**
   ```bash
   git revert HEAD
   npm install
   npm start
   ```

3. **Check Database**
   - Restore from backup if needed

4. **Verify Service**
   - Test all endpoints
   - Check logs for errors

---

## Post-Deployment

### Validation Checklist

- [ ] All endpoints responding
- [ ] Authentication working
- [ ] Database connectivity verified
- [ ] CORS configured correctly
- [ ] HTTPS working
- [ ] Monitoring active
- [ ] Backups scheduled
- [ ] Logs being collected

### Performance Verification

```bash
# Test endpoints
curl -X GET http://your-domain.com/api/auth/me

# Load test
ab -n 1000 -c 100 http://your-domain.com/api/auth/me
```

---

## Maintenance Schedule

### Daily
- Check uptime and monitoring
- Review error logs
- Monitor resource usage

### Weekly
- Review performance metrics
- Check backup completion
- Update dependencies (if safe)

### Monthly
- Security audit
- Database optimization
- Clean up old logs

### Quarterly
- Major updates
- Performance review
- Capacity planning

---

## Disaster Recovery

### Recovery Time Objectives (RTO)

- Maximum acceptable downtime: 30 minutes
- Maximum data loss: 1 hour

### Recovery Procedure

1. **Database Restore**
   ```bash
   mongorestore --uri "mongodb+srv://..." /backups/latest
   ```

2. **Application Restart**
   ```bash
   pm2 restart all
   ```

3. **Verification**
   - Run health checks
   - Verify key data
   - Check logs

---

## Security Hardening

### API Security

1. **Rate Limiting**
   ```bash
   npm install express-rate-limit
   ```

2. **Input Validation**
   ```bash
   npm install joi
   ```

3. **SQL/NoSQL Injection Prevention**
   - Use parameterized queries (Mongoose has this)
   - Validate all inputs

### Infrastructure Security

1. **Firewall Rules**
   - Only open necessary ports
   - Whitelist trusted IPs

2. **SSL/TLS**
   - Use strong ciphers
   - Keep certificates updated

3. **Data Encryption**
   - Encrypt data at rest
   - Encrypt data in transit

---

## Support & Documentation

For detailed information:
- See `SETUP_GUIDE.md` for installation
- See `API_DOCUMENTATION.md` for API specs
- See `DATABASE_SCHEMA.md` for schema details

---

Need help with deployment? Check the troubleshooting section in the main README.
