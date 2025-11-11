export function basicBot(bot, target, FUEL_PER_FRAME, fireMissile) {
    if (bot.destroyed) return;
    
    const dx = target.x - bot.x;
    const dy = target.y - bot.y;
    let angleToTarget = Math.atan2(dy, dx);
    
    // Add a small random offset to break the mirroring
    const randomness = (Math.random() - 0.5) * 0.5; // Random value between -0.25 and 0.25
    angleToTarget += randomness;

    let angleDiff = angleToTarget - bot.angle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    if (Math.abs(angleDiff) > 0.05) {
        if (angleDiff > 0) {
            bot.rotateRight();
        } else {
            bot.rotateLeft();
        }
    }

    const preferredDistance = 150;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > preferredDistance && bot.fuel > 0) {
        bot.engageThrust();
    }

    const angleTolerance = 0.1;
    const firingDistance = 180;
    const firingChance = 0.05; // 5% chance to fire each frame
    
    if (bot.missiles > 0 && Math.abs(angleDiff) < angleTolerance && distance < firingDistance && Math.random() < firingChance) {
        fireMissile(bot);
    }
}
