const { ErroValidacao } = require('../utils/validacao');

function errorHandler(err, c) {
    if (err instanceof ErroValidacao) {
        return c.json({ message: err.message }, err.status);
    }

    console.error('❌ Erro não tratado na rota', c.req.method, c.req.path, ':', err);
    return c.json({ message: 'Erro interno no servidor. Verifique os logs.' }, 500);
}

module.exports = { errorHandler };
