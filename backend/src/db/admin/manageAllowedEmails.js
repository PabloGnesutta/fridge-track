import { db } from '../db.js';
import { addAllowedEmail, removeAllowedEmail, listAllowedEmails } from '../allowedEmails.js';
import { verifyUserEmail } from './usersAdmin.js';


function printUsage() {
  console.log('Uso:');
  console.log('  node manageAllowedEmails.js add <email>');
  console.log('  node manageAllowedEmails.js remove <email>');
  console.log('  node manageAllowedEmails.js list');
  console.log('  node manageAllowedEmails.js verify <email>   (marca el email como verificado, sin código)');
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

  case 'verify': {
    if (!email) { printUsage(); process.exit(1); }
    const result = verifyUserEmail(db, email);
    if (!result) {
      console.log(`No existe una cuenta con el email ${email}.`);
      process.exit(1);
    }
    console.log(
      result.alreadyVerified
        ? `Ya estaba verificado: ${result.email}`
        : `Verificado: ${result.email}`
    );
    break;
  }

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
