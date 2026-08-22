import { db } from './db.js';
import { listHomes, previewHomeCascade, deleteHomeCascade } from './homesAdmin.js';


function printUsage() {
  console.log('Uso:');
  console.log('  node manageHomes.js list');
  console.log('  node manageHomes.js delete <homeId>          (dry run - shows what would be deleted)');
  console.log('  node manageHomes.js delete <homeId> --yes    (actually deletes)');
}

const [, , command, homeIdArg, flag] = process.argv;

switch (command) {
  case 'list': {
    const homes = listHomes(db);
    if (!homes.length) {
      console.log('No hay Hogares.');
      break;
    }
    for (const home of homes) {
      console.log(
        `#${home.id}  "${home.name}"  código: ${home.joinCode}  creado por: ${home.createdByEmail || '(desconocido)'}`
        + `  el ${new Date(home.createdAt).toISOString()}`
      );
      console.log(
        `      miembros: ${home.memberCount}  ubicaciones: ${home.locationCount}  alimentos: ${home.itemCount}`
      );
    }
    break;
  }

  case 'delete': {
    const homeId = Number(homeIdArg);
    if (!homeIdArg || !Number.isInteger(homeId)) { printUsage(); process.exit(1); }

    const preview = previewHomeCascade(db, homeId);
    if (!preview.home) {
      console.log(`No existe un Hogar con id ${homeId}.`);
      process.exit(1);
    }

    console.log(`Hogar #${preview.home.id} "${preview.home.name}" y todo lo asociado:`);
    console.log(`  ${preview.items} alimentos`);
    console.log(`  ${preview.locations} ubicaciones`);
    console.log(`  ${preview.foodNameHistory} entradas de historial`);
    console.log(`  ${preview.categories} categorías`);
    console.log(`  ${preview.members} membresías`);
    console.log(`  ${preview.notificationLog} registros de notificaciones enviadas`);

    if (flag !== '--yes') {
      console.log('\nEsto es un dry run - no se borró nada.');
      console.log(`Volvé a ejecutar con --yes para borrar de verdad: node manageHomes.js delete ${homeId} --yes`);
      break;
    }

    const result = deleteHomeCascade(db, homeId);
    console.log(`\nBorrado Hogar #${result.home.id} "${result.home.name}".`);
    break;
  }

  default:
    printUsage();
    process.exit(1);
}
