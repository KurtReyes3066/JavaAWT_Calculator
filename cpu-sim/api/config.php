<?php
/**
 * Database settings. Defaults match a stock XAMPP install (user "root",
 * empty password). Override with environment variables if needed.
 */
return [
    'host'     => getenv('CPU_SIM_DB_HOST') ?: '127.0.0.1',
    'port'     => (int) (getenv('CPU_SIM_DB_PORT') ?: 3306),
    'database' => getenv('CPU_SIM_DB_NAME') ?: 'cpu_scheduler',
    'username' => getenv('CPU_SIM_DB_USER') ?: 'root',
    'password' => getenv('CPU_SIM_DB_PASS') !== false ? getenv('CPU_SIM_DB_PASS') : '',
];
