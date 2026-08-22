import { db } from '../db.js';
import { previewUserCascade, deleteUserCascade } from './usersAdmin.js';


function printUsage() {
  console.log('Uso:');
  console.log('  node manageUsers.js delete <email>          (dry run - muestra qué se borraría)');
  console.log('  node manageUsers.js delete <email> --yes    (borra de verdad)');
}

const [, , command, email, flag] = process.argv;

switch (command) {
  case 'delete': {
    if (!email) { printUsage(); process.exit(1); }

    const preview = previewUserCascade(db, email);
    if (!preview.user) {
      console.log(`No existe una cuenta con el email ${email}.`);
      process.exit(1);
    }

    console.log(`Usuario #${preview.user.id} "${preview.user.email}" y todo lo asociado:`);
    console.log(`  ${preview.sessions} sesiones activas`);
    console.log(`  ${preview.pushSubscriptions} suscripciones push`);
    console.log(`  ${preview.notificationLog} registros de notificaciones enviadas`);
    console.log(`  ${preview.memberships} membresías a Hogares`);
    if (preview.homesCreated.length) {
      console.log(
        `  ${preview.homesCreated.length} Hogar(es) creado(s) por este usuario`
        + ' - se borrarán ENTERAMENTE, junto con todo su contenido:'
      );
      for (const home of preview.homesCreated) {
        const warning = home.memberCount > 1
          ? `  (¡tiene ${home.memberCount} miembros - los demás perderán acceso!)`
          : '';
        console.log(`    #${home.id} "${home.name}"${warning}`);
      }
    }

    if (flag !== '--yes') {
      console.log('\nEsto es un dry run - no se borró nada.');
      console.log(`Volvé a ejecutar con --yes para borrar de verdad: node manageUsers.js delete ${email} --yes`);
      break;
    }

    const result = deleteUserCascade(db, email);
    console.log(`\nBorrado usuario #${result.user.id} "${result.user.email}".`);
    if (result.deletedHomes.length) {
      console.log(
        `También se borraron ${result.deletedHomes.length} Hogar(es): `
        + result.deletedHomes.map(h => `"${h.name}"`).join(', ')
      );
    }
    break;
  }

  default:
    printUsage();
    process.exit(1);
}
