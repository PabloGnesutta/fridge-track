import { createLocation } from "./location-db.js";
import { createItem } from "./item-db.js";


/**
 * Dev helper: seeds a location with a few items in different freshness states.
 */
async function seedDb() {
    const today = new Date();
    const daysAgo = n => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
    const daysFromNow = n => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);

    const { data: location } = await createLocation('Heladera');
    if (!location) { return; }

    await createItem(location._key || '', 'Leche', {
        quantity: '1 litro',
        addedDate: daysAgo(5),
        useByDate: daysAgo(1),
    });

    await createItem(location._key || '', 'Yogur', {
        quantity: '4 unidades',
        addedDate: daysAgo(1),
        shelfLifeDays: 3,
    });

    await createItem(location._key || '', 'Queso', {
        quantity: '200g',
        addedDate: today,
        useByDate: daysFromNow(15),
    });
}


export { seedDb };
