export function UserInput(ship, thrust, left, right, fire) {
    function update(keys) {
        const unset = [];
        if (keys[thrust]) ship.engageThrust();
        if (keys[left]) ship.rotateLeft();
        if (keys[right]) ship.rotateRight();
        if (keys[fire]) {
            ship.fire();
            unset.push(fire);
        }
        return unset;
    }

    return {
        update,
    }
}
