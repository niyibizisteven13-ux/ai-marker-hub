export default {
  apps: [
    {
      name: 'bwenge.space',
      script: './dist/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
    },
  ],
};
