import { db } from './db.js';
import { addAllowedEmail, removeAllowedEmail, listAllowedEmails } from './allowedEmails.js';


function printUsage() {
  console.log('Uso:');
  console.log('  node manageAllowedEmails.js add <email>');
  console.log('  node manageAllowedEmails.js remove <email>');
  console.log('  node manageAllowedEmails.js list');
}

const [, , command, email] = process.argv;

switch (command) {
  case 'add':
    if (!email) { printUsage(); process.exit(1); }
    addAllowedEmail(db, email);
    console.log(`Agregado: ${email.trim().toLowerCase()}`);
    break;

  case 'remove':
    if (!email) { printUsage(); process.exit(1); }
    removeAllowedEmail(db, email);
    console.log(`Eliminado: ${email.trim().toLowerCase()}`);
    break;

  case 'list': {
    const emails = listAllowedEmails(db);
    if (!emails.length) {
      console.log('No hay emails autorizados.');
    } else {
      emails.forEach(e => console.log(e));
    }
    break;
  }

  default:
    printUsage();
    process.exit(1);
}
