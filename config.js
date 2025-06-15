const { ActivityType } = require('discord.js');

module.exports = {
  ownerId: '581125812112064512',
  status: {
    rotateDefault: [
      { name: 'Netflix', type: ActivityType.Watching },
      { name: 'GTA VI', type: ActivityType.Playing },
      { name: 'on YouTube', type: ActivityType.Streaming,},
      { name: 'Spotify', type: ActivityType.Listening },
    ],
    songStatus: true
  },
  spotifyClientId: "f71a3da30e254962965ca2a89d6f74b9",
  spotifyClientSecret: "199a619d22dd4e55a4a2c1a7a3d70e63",
}
