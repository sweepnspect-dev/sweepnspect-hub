// PM2 Ecosystem Config — SweepNspect Hub
// Start both: pm2 start ecosystem.config.js
// Logs go to ./logs/
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'hub',
      script: 'server.js',
      cwd: __dirname,
      env: {
        PORT: 8888,
        NODE_ENV: 'production'
      },
      max_memory_restart: '512M',
      autorestart: true,
      watch: false,
      out_file: './logs/hub-out.log',
      error_file: './logs/hub-err.log',
      merge_logs: true,
      time: true,
      // Enable DND when Hub stops (J is offline)
      kill_timeout: 5000,
      shutdown_with_message: true,
      pre_stop: path.join(__dirname, 'scripts', 'enable-dnd.sh')
    },
    {
      name: 'ai-proxy',
      script: 'ai-proxy.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production'
        // ANTHROPIC_API_KEY injected by start-hub.sh before pm2 start
      },
      max_memory_restart: '256M',
      autorestart: true,
      watch: false,
      out_file: './logs/ai-proxy-out.log',
      error_file: './logs/ai-proxy-err.log',
      merge_logs: true,
      time: true
    }
  ]
};
