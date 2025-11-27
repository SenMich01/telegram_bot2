module.exports = {
  apps: [{
    name: 'betting-bot',
    script: './dist/main.js', // Path to your compiled JavaScript file
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 8080
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    restart_delay: 4000, // Wait 4 seconds before restarting after crash
    max_restarts: 10, // Max restarts within 1 minute before giving up
    min_uptime: '10s', // Minimum uptime to not be considered unstable
    listen_timeout: 3000,
    kill_timeout: 5000,
    cron_restart: '0 3 * * *', // Optional: Restart daily at 3 AM for memory cleanup
    
    // Auto-restart on file changes (disable in production)
    // watch: ['dist'],
    // ignore_watch: ['node_modules', 'logs', '*.json'],
    
    // Environment variables for different stages
    env_development: {
      NODE_ENV: 'development',
      PORT: 8080
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 8080
    }
  }]
};