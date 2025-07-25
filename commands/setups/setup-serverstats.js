const { SlashCommandBuilder, PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');
const { serverStatsCollection } = require('../../mongodb');
const checkPermissions = require('../../utils/checkPermissions');
const cmdIcons = require('../../UI/icons/commandicons');


const statTypes = ["members", "bots", "textchannels", "voicechannels", "categories", "roles", "date"];


const defaultNameFormats = {
    members: "👥 Members: {count}",
    bots: "🤖 Bots: {count}",
    textchannels: "💬 Text Channels: {count}",
    voicechannels: "🔊 Voice Channels: {count}",
    categories: "📁 Categories: {count}",
    roles: "🏷️ Roles: {count}",
    date: "📅 Date: {count}"
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-serverstats')
        .setDescription('Manage server statistics channels')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels)
        
        .addSubcommand(sub => 
            sub.setName('setup')
                .setDescription('Configure server stats channels')
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Select which stat to track')
                        .setRequired(true)
                        .addChoices({ name: 'All Stats', value: 'all' }, ...statTypes.map(type => ({ name: type, value: type })))
                )
                .addBooleanOption(option => option.setName('active').setDescription('Enable or disable this stat').setRequired(true))
                .addChannelOption(option => option.setName('category').setDescription('Select a category').addChannelTypes(ChannelType.GuildCategory).setRequired(false))
                .addStringOption(option => option.setName('name').setDescription('Custom name (use {count})').setRequired(false))
        )

        .addSubcommand(sub =>
            sub.setName('view')
                .setDescription('View the current server stats setup')
        )

        .addSubcommand(sub =>
            sub.setName('delete')
                .setDescription('Delete a specific server stat entry')
                .addIntegerOption(option => 
                    option.setName('index')
                        .setDescription('Index of the stat to delete (from /serverstats view)')
                        .setRequired(true))
        )

        .addSubcommand(sub =>
            sub.setName('clear')
                .setDescription('Delete all server stats setups')
        ),

    async execute(interaction) {
        if (interaction.isCommand && interaction.isCommand()) {
            await interaction.deferReply({ ephemeral: true });

            const guild = interaction.guild;
            const guildId = guild.id;
            if (!await checkPermissions(interaction)) return;
            const subcommand = interaction.options.getSubcommand();

            if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
                return interaction.editReply({ content: '❌ I need `Manage Channels` permission!' });
            }

            if (subcommand === "setup") {
                const type = interaction.options.getString('type');
                const active = interaction.options.getBoolean('active');
                const category = interaction.options.getChannel('category');
                const categoryId = category ? category.id : null;
                const customName = interaction.options.getString('name');

                const typesToCreate = type === "all" ? statTypes : [type];
                const createdChannels = [];
                const updatedChannels = [];
                const errors = [];

                // Fetch current stats to get initial values
                const statsData = await fetchStatsData(guild);

                for (const stat of typesToCreate) {
                    try {
                        // Use custom name or default format if not provided
                        const nameFormat = customName || defaultNameFormats[stat] || `{count} ${stat}`;
                    
                        // Get the initial value for this stat type
                        let initialValue = statsData ? (statsData[stat] || '0') : '0';
                    
                        // Look for existing stats channel in DB
                        const existingStat = await serverStatsCollection.findOne({ guildId, type: stat });
                        let existingChannel = existingStat?.channelId ? guild.channels.cache.get(existingStat.channelId) : null;
                        
                        // Try to fetch if not in cache
                        if (existingStat?.channelId && !existingChannel) {
                            try {
                                existingChannel = await guild.channels.fetch(existingStat.channelId).catch(() => null);
                            } catch (err) {
                                console.log(`Channel ${existingStat.channelId} not found`);
                            }
                        }
                    
                        // Create or delete channel based on active state
                        if (!existingChannel && active) {
                            existingChannel = await guild.channels.create({
                                name: nameFormat.replace('{count}', initialValue),
                                type: ChannelType.GuildVoice,
                                parent: categoryId || null,
                                permissionOverwrites: [
                                    { id: guild.roles.everyone.id, deny: ['Connect'] }
                                ]
                            });
                    
                            await existingChannel.setPosition(0).catch(() => {});
                            createdChannels.push(stat);
                        } else if (existingChannel && !active) {
                            // If deactivating, delete the channel if it exists
                            await existingChannel.delete().catch(() => {});
                            existingChannel = null;
                        } else if (existingChannel && active) {
                            // Update existing channel with new name format and category
                            if (categoryId !== existingStat?.categoryId) {
                                await existingChannel.setParent(categoryId || null).catch(() => {});
                            }
                            
                            // Update the channel name with new format and current value
                            if (nameFormat !== existingStat?.customName) {
                                await existingChannel.setName(nameFormat.replace('{count}', initialValue)).catch(() => {});
                            }
                            
                            updatedChannels.push(stat);
                        }
                    
                        // Update database
                        await serverStatsCollection.updateOne(
                            { guildId, type: stat },
                            {
                                $set: {
                                    guildId,
                                    type: stat,
                                    channelId: existingChannel?.id || null,
                                    categoryId,
                                    active,
                                    customName: nameFormat
                                }
                            },
                            { upsert: true }
                        );
                    } catch (err) {
                        console.error(`Error setting up ${stat} stat for guild ${guildId}:`, err);
                        errors.push(stat);
                    }
                }

                // Build response message
                let response = `✅ **${type === "all" ? "All Stats" : type}** are now **${active ? 'enabled' : 'disabled'}**.`;
                
                if (createdChannels.length) {
                    response += `\n📊 Created channels for: ${createdChannels.join(', ')}`;
                }
                
                if (updatedChannels.length) {
                    response += `\n🔄 Updated settings for: ${updatedChannels.join(', ')}`;
                }
                
                if (errors.length) {
                    response += `\n❌ Errors with: ${errors.join(', ')}`;
                }

                // Trigger an immediate stats update
                triggerStatsUpdate(guild);

                return interaction.editReply({ content: response });

            } else if (subcommand === "view") {
                const stats = await serverStatsCollection.find({ guildId }).toArray();
                
                if (!stats.length) return interaction.editReply({ content: '📊 No server stats are currently set up.' });

                const embed = new EmbedBuilder()
                    .setTitle('📊 Server Stats Configuration')
                    .setColor('#3498db')
                    .setDescription('Current server statistics tracking setup')
                    .setFooter({ text: `Server ID: ${guildId}` })
                    .setTimestamp();

                stats.forEach((stat, i) => {
                    embed.addFields({
                        name: `${i + 1}. ${stat.type}`,
                        value: [
                            `**Channel:** ${stat.channelId ? `<#${stat.channelId}>` : 'None'}`,
                            `**Status:** ${stat.active ? '✅ Active' : '❌ Inactive'}`,
                            `**Format:** \`${stat.customName}\``,
                            `**Category:** ${stat.categoryId ? `<#${stat.categoryId}>` : 'None'}`
                        ].join('\n'),
                        inline: false
                    });
                });

                return interaction.editReply({ embeds: [embed] });

            } else if (subcommand === "delete") {
                const index = interaction.options.getInteger('index') - 1;
                const stats = await serverStatsCollection.find({ guildId }).toArray();

                if (index < 0 || index >= stats.length) return interaction.editReply({ content: '❌ Invalid index provided.' });

                const statToDelete = stats[index];
                await serverStatsCollection.deleteOne({ _id: statToDelete._id });

                if (statToDelete.channelId) {
                    const channel = guild.channels.cache.get(statToDelete.channelId);
                    if (channel) {
                        await channel.delete().catch((err) => {
                            console.error(`Failed to delete channel for stat ${statToDelete.type}:`, err);
                            return interaction.editReply({ 
                                content: `✅ Deleted **${statToDelete.type}** from database, but failed to delete channel <#${statToDelete.channelId}>. You may need to delete it manually.` 
                            });
                        });
                    }
                }

                return interaction.editReply({ content: `✅ Successfully deleted **${statToDelete.type}** server stat.` });

            } else if (subcommand === "clear") {
                // Get all active stats
                const stats = await serverStatsCollection.find({ guildId }).toArray();
                
                // Delete all channels
                let deletedCount = 0;
                let failedCount = 0;
                
                for (const stat of stats) {
                    if (stat.channelId) {
                        const channel = guild.channels.cache.get(stat.channelId);
                        if (channel) {
                            try {
                                await channel.delete();
                                deletedCount++;
                            } catch (err) {
                                console.error(`Failed to delete channel for stat ${stat.type}:`, err);
                                failedCount++;
                            }
                        }
                    }
                }
                
                // Delete all database entries
                await serverStatsCollection.deleteMany({ guildId });

                let response = `✅ All server stats configurations have been deleted.`;
                if (deletedCount > 0) {
                    response += `\n🗑️ Deleted ${deletedCount} stat channels.`;
                }
                if (failedCount > 0) {
                    response += `\n⚠️ Failed to delete ${failedCount} channels. You may need to remove them manually.`;
                }

                return interaction.editReply({ content: response });
            }
        } else {
            const embed = new EmbedBuilder()
                .setColor('#3498db')
                .setAuthor({ 
                    name: "Alert!", 
                    iconURL: cmdIcons.dotIcon,
                    url: "https://discord.gg/G5eb3D4BfN"
                })
                .setDescription('- This command can only be used through slash commands!\n- Please use `/setup-serverstats`')
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        }
    }
};

// Helper function to fetch stats data
async function fetchStatsData(guild) {
    try {
        const members = await guild.members.fetch({ force: true });
        const roles = await guild.roles.fetch();
        const channels = await guild.channels.fetch();
        
        const locale = guild.preferredLocale || 'en-US';
        
        // Format date
        const date = new Date();
        const day = date.getDate();
        const ordinal = (d) => {
            if (d > 3 && d < 21) return 'th';
            switch (d % 10) {
                case 1: return 'st';
                case 2: return 'nd';
                case 3: return 'rd';
                default: return 'th';
            }
        };
        const months = date.toLocaleString(locale, { month: 'long' });
        const weekday = date.toLocaleString(locale, { weekday: 'short' });
        const formattedDate = `${day}${ordinal(day)} ${months} (${weekday})`;
        
        return {
            members: members.filter(m => !m.user.bot).size,
            bots: members.filter(m => m.user.bot).size,
            textchannels: channels.filter(ch => ch.type === ChannelType.GuildText).size,
            voicechannels: channels.filter(ch => ch.type === ChannelType.GuildVoice).size,
            categories: channels.filter(ch => ch.type === ChannelType.GuildCategory).size,
            roles: roles.size,
            date: formattedDate
        };
    } catch (err) {
        console.error(`Error fetching stats data for guild ${guild.id}:`, err);
        return null;
    }
}

function triggerStatsUpdate(guild) {
  
    const event = new CustomEvent('statsUpdate', { detail: { guildId: guild.id } });
    process.emit('statsUpdate', guild);
}