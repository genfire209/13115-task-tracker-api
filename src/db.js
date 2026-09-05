const sql = require('mssql');

let poolPromise;

/** Returns a shared connection pool to Azure SQL, created lazily. */
function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(process.env.SQL_CONNECTION_STRING);
  }
  return poolPromise;
}

module.exports = { sql, getPool };
