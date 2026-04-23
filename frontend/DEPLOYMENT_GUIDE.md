# Deployment Guide - Interactive Editor

## 🎯 Overview

This guide covers deploying the enhanced interactive editor to production.

## ✅ Pre-Deployment Checklist

### Code Review
- [ ] All files committed to version control
- [ ] No console.log statements in production code
- [ ] No hardcoded URLs or credentials
- [ ] Error handling is comprehensive
- [ ] Code is documented

### Testing
- [ ] All tests in TESTING_CHECKLIST.md passed
- [ ] Tested in multiple browsers
- [ ] Tested on mobile devices
- [ ] Performance is acceptable
- [ ] No memory leaks

### Documentation
- [ ] README is up to date
- [ ] API documentation is current
- [ ] User guides are complete
- [ ] Migration guide is ready

### Dependencies
- [ ] All npm packages are up to date
- [ ] No security vulnerabilities
- [ ] License compliance checked
- [ ] Bundle size is acceptable

## 🚀 Deployment Steps

### 1. Frontend Build

```bash
cd frontend

# Install dependencies
npm install

# Run tests (if available)
npm test

# Build for production
npm run build

# Output will be in frontend/dist/
```

### 2. Backend Preparation

```bash
cd backend

# Install dependencies
npm install

# Run database migrations
npm run migrate

# Verify environment variables
cat .env
```

### 3. Environment Variables

#### Frontend (.env)
```env
VITE_API_URL=https://your-api-domain.com
VITE_APP_NAME=Interactive EPUB Editor
```

#### Backend (.env)
```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
PORT=5000
NODE_ENV=production
JWT_SECRET=your-secret-key
```

### 4. Database Migration

```sql
-- Run interactive blocks migration
psql -U postgres -d production_db -f backend/database/migrations/004_interactive_blocks.sql

-- Verify tables exist
\dt interactive_*

-- Check data
SELECT COUNT(*) FROM interactive_books;
SELECT COUNT(*) FROM interactive_chapters;
SELECT COUNT(*) FROM interactive_blocks;
```

### 5. Deploy Frontend

#### Option A: Static Hosting (Netlify, Vercel)

```bash
# Build
npm run build

# Deploy to Netlify
netlify deploy --prod --dir=dist

# Or deploy to Vercel
vercel --prod
```

#### Option B: Traditional Server (Nginx)

```bash
# Copy build files
scp -r dist/* user@server:/var/www/html/

# Nginx configuration
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 6. Deploy Backend

#### Option A: PM2 (Process Manager)

```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start backend/src/server.js --name "epub-backend"

# Save PM2 configuration
pm2 save

# Setup startup script
pm2 startup
```

#### Option B: Docker

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 5000

CMD ["node", "src/server.js"]
```

```bash
# Build image
docker build -t epub-backend .

# Run container
docker run -d -p 5000:5000 --name epub-backend epub-backend
```

### 7. SSL Certificate (Let's Encrypt)

```bash
# Install Certbot
sudo apt-get install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal
sudo certbot renew --dry-run
```

## 🔒 Security Checklist

### Frontend
- [ ] HTTPS enabled
- [ ] Content Security Policy configured
- [ ] XSS protection enabled
- [ ] CORS properly configured
- [ ] No sensitive data in client code

### Backend
- [ ] Environment variables secured
- [ ] Database credentials encrypted
- [ ] JWT secret is strong
- [ ] Rate limiting enabled
- [ ] Input validation on all endpoints

### Database
- [ ] Strong passwords
- [ ] Limited user permissions
- [ ] Regular backups configured
- [ ] SSL connections enabled
- [ ] Firewall rules in place

## 📊 Monitoring

### Application Monitoring

```javascript
// Add to backend
const monitoring = require('./monitoring');

app.use(monitoring.requestLogger);
app.use(monitoring.errorTracker);
```

### Health Checks

```javascript
// Backend health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    uptime: process.uptime(),
    database: 'connected'
  });
});
```

### Logging

```javascript
// Use Winston or similar
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
```

## 🔄 Rollback Plan

### If Deployment Fails

1. **Revert Frontend**
```bash
# Restore previous build
cp -r dist.backup/* dist/

# Or rollback in Netlify/Vercel
netlify rollback
```

2. **Revert Backend**
```bash
# Stop current version
pm2 stop epub-backend

# Start previous version
pm2 start epub-backend-backup

# Or rollback Docker
docker stop epub-backend
docker start epub-backend-backup
```

3. **Revert Database**
```sql
-- Restore from backup
pg_restore -U postgres -d production_db backup.dump
```

## 📈 Performance Optimization

### Frontend

```javascript
// Lazy load components
const InteractiveEditor = lazy(() => import('./pages/interactive/InteractiveEditorEnhanced'));

// Code splitting
import(/* webpackChunkName: "editor" */ './components/CKEditorEnhanced');

// Image optimization
<img loading="lazy" src={url} alt={alt} />
```

### Backend

```javascript
// Enable compression
const compression = require('compression');
app.use(compression());

// Cache static assets
app.use(express.static('public', {
  maxAge: '1y',
  etag: false
}));

// Database connection pooling
const pool = new Pool({
  max: 20,
  idleTimeoutMillis: 30000
});
```

## 🔍 Post-Deployment Verification

### Automated Tests

```bash
# Run smoke tests
npm run test:smoke

# Check endpoints
curl https://your-domain.com/health
curl https://your-domain.com/api/health
```

### Manual Verification

- [ ] Homepage loads
- [ ] Login works
- [ ] Can create book
- [ ] Can create chapter
- [ ] Can add text block
- [ ] Can add quiz
- [ ] Can add image
- [ ] Can add audio
- [ ] Can add drag-drop
- [ ] Preview works
- [ ] Reader works
- [ ] No console errors

### Performance Checks

```bash
# Lighthouse audit
lighthouse https://your-domain.com --view

# Load testing
ab -n 1000 -c 10 https://your-domain.com/
```

## 📊 Metrics to Monitor

### Application Metrics
- Response time
- Error rate
- Request count
- Active users
- Database queries

### Business Metrics
- Books created
- Chapters created
- Blocks created
- User engagement
- Feature usage

## 🔔 Alerting

### Setup Alerts For:
- Server down
- High error rate
- Slow response time
- Database issues
- Disk space low
- Memory usage high

### Alert Channels
- Email
- Slack
- SMS (critical only)
- PagerDuty

## 📝 Deployment Checklist

### Pre-Deployment
- [ ] Code reviewed
- [ ] Tests passed
- [ ] Documentation updated
- [ ] Backup created
- [ ] Team notified

### Deployment
- [ ] Frontend built
- [ ] Backend deployed
- [ ] Database migrated
- [ ] SSL configured
- [ ] Monitoring enabled

### Post-Deployment
- [ ] Smoke tests passed
- [ ] Manual verification done
- [ ] Performance acceptable
- [ ] No errors in logs
- [ ] Team notified

## 🎯 Deployment Environments

### Development
- URL: http://localhost:3000
- Database: dev_database
- Purpose: Active development

### Staging
- URL: https://staging.your-domain.com
- Database: staging_database
- Purpose: Pre-production testing

### Production
- URL: https://your-domain.com
- Database: production_database
- Purpose: Live users

## 🔄 Continuous Deployment

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Setup Node
        uses: actions/setup-node@v2
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Run tests
        run: npm test
      
      - name: Build
        run: npm run build
      
      - name: Deploy
        run: npm run deploy
```

## 📚 Documentation Updates

### After Deployment
- [ ] Update README with production URL
- [ ] Document any configuration changes
- [ ] Update API documentation
- [ ] Create release notes
- [ ] Update changelog

## 🎉 Launch Announcement

### Internal
- Email to team
- Slack announcement
- Demo session
- Training materials

### External
- Blog post
- Social media
- Email to users
- Documentation site

## 📞 Support Plan

### During Launch
- Monitor closely for 24 hours
- Have team on standby
- Quick response to issues
- Regular status updates

### Ongoing
- Regular maintenance windows
- Update schedule
- Support channels
- Escalation process

## 🔮 Future Improvements

### Short Term
- [ ] Add analytics
- [ ] Improve performance
- [ ] Add more tests
- [ ] Enhance monitoring

### Long Term
- [ ] Auto-scaling
- [ ] Multi-region deployment
- [ ] CDN integration
- [ ] Advanced caching

## ✅ Sign-Off

### Deployment Completed By
- Name: _______________
- Date: _______________
- Time: _______________

### Verified By
- Name: _______________
- Date: _______________
- Time: _______________

### Production URL
- Frontend: _______________
- Backend: _______________
- Database: _______________

### Notes
_______________________________________________
_______________________________________________
_______________________________________________

---

**Deployment successful! 🎉**
