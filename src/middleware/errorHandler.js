const { ErroValidacao } = require('../utils/validacao');

function errorHandler(err, c) {
    if (err instanceof ErroValidacao) {
        return c.json({ message: err.message }, err.status);
    }

    // Erros de negócio lançados pelos services com um status HTTP definido (400/404/409...)
    // devem chegar ao usuário com a mensagem real — antes viravam um 500 genérico.
    if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
        return c.json({ message: err.message }, err.status);
    }

    // Violação de UNIQUE do SQLite (emoji de funcionário, e-mail de admin, data de feriado...)
    // vira uma mensagem amigável em vez de "Erro interno".
    const texto = String(err && err.message || '');
    if (texto.includes('UNIQUE constraint failed')) {
        let message = 'Já existe um cadastro com esse valor único.';
        if (texto.includes('funcionarios.emoji')) message = 'Esse emoji já está em uso por outro funcionário. Escolha outro.';
        else if (texto.includes('admins.email')) message = 'Já existe uma conta de administrador com esse e-mail.';
        else if (texto.includes('feriados.data')) message = 'Já existe um feriado cadastrado nessa data.';
        else if (texto.includes('registro_ponto') || texto.includes('idx_registro_unico')) {
            message = 'Já existe uma batida desse tipo nesse dia para este funcionário. Corrija o horário da batida existente em vez de lançar outra.';
        }
        return c.json({ message }, 409);
    }

    console.error('❌ Erro não tratado na rota', c.req.method, c.req.path, ':', err);
    return c.json({ message: 'Erro interno no servidor. Verifique os logs.' }, 500);
}

module.exports = { errorHandler };
