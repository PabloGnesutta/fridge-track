import { db } from '../db.js';
import { addAllowedEmail, removeAllowedEmail, renameAllowedEmail, listAllowedEmails } from '../allowedEmails.js';
import { verifyUserEmail, updateUserEmail } from './usersAdmin.js';


function printUsage() {
  console.log('Uso:');
  console.log('  node manageAllowedEmails.js add <email>');
  console.log('  node manageAllowedEmails.js remove <email>');
  console.log('  node manageAllowedEmails.js edit <email actual> <email nuevo>');
  console.log('  node manageAllowedEmails.js list');
  console.log('  node manageAllowedEmails.js verify <email>   (marca el email como verificado, sin código)');
}

const [, , command, email, newEmail] = process.argv;

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

  case 'edit': {
    if (!email || !newEmail) { printUsage(); process.exit(1); }

    const normalizedOld = email.trim().toLowerCase();
    const normalizedNew = newEmail.trim().toLowerCase();

    let allowedEmailChanged;
    let userResult;
    db.exec('BEGIN');
    try {
      allowedEmailChanged = renameAllowedEmail(db, normalizedOld, normalizedNew);
      userResult = updateUserEmail(db, normalizedOld, normalizedNew);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    if (!allowedEmailChanged && !userResult) {
      console.log(`No se encontró ${normalizedOld} ni en allowed_emails ni en la tabla de usuarios.`);
      process.exit(1);
    }

    console.log(
      allowedEmailChanged
        ? `Reemplazado en allowed_emails: ${normalizedOld} -> ${normalizedNew}`
        : `${normalizedOld} no estaba en allowed_emails - no se modificó esa tabla.`
    );
    console.log(
      userResult
        ? `Actualizado usuario #${userResult.id}: ${normalizedOld} -> ${normalizedNew}`
        : `No había ninguna cuenta de usuario con el email ${normalizedOld}.`
    );
    break;
  }

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
