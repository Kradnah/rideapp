# Backups

Copias de seguridad de rideapp (13.7, paso 5): base de datos y documentos de conductores, cifrados con [`age`](https://age-encryption.org) antes de escribirse en disco. Los volcados nunca se guardan en el repositorio.

| Script            | Dónde corre                 | Qué hace                                                                                              |
| ----------------- | --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `backup.sh`       | VPS (cron nocturno)         | `pg_dump -Fc` + tar de `/app/var/storage` → `age` → `~/backups/rideapp`; 7 diarios y 4 semanales      |
| `restore-test.sh` | Tu PC (donde está la clave) | Descifra un volcado, lo restaura en un Postgres **temporal** y comprueba migraciones, datos y PostGIS |

## Por qué así

- **La clave privada no vive en el VPS.** El servidor solo tiene la clave pública: puede cifrar, pero quien lo comprometa no puede leer los backups. La privada se guarda en tu gestor de contraseñas y en tu PC.
- **Los documentos ya van cifrados** con una clave derivada de `FIELD_ENCRYPTION_KEY`. Sin esa variable no se pueden recuperar: guárdala también en el gestor de contraseñas, junto a la clave de `age` (sección 13.6).
- **Formato custom de `pg_dump`**: comprimido y restaurable por tablas.
- **Copia fuera del VPS** con `rclone` (Backblaze B2 o Cloudflare R2 tienen capa gratuita): si se pierde el servidor, no se pierden los backups.

## Puesta en marcha (una sola vez)

En tu PC:

```bash
age-keygen -o rideapp-backup.key        # imprime la clave pública (age1…)
# Guarda rideapp-backup.key en el gestor de contraseñas. No la subas al VPS.
```

En el VPS (usuario `admin`):

```bash
sudo apt install age                    # rclone solo si vas a copiar fuera
mkdir -p ~/.config/rideapp-backup ~/bin
echo 'age1…' > ~/.config/rideapp-backup/recipients.txt   # SOLO la clave pública
# Copia backup.sh a ~/bin/rideapp-backup.sh y dale permisos
chmod 700 ~/bin/rideapp-backup.sh

# Prueba manual: debe terminar con "OK"
AGE_RECIPIENTS_FILE=~/.config/rideapp-backup/recipients.txt ~/bin/rideapp-backup.sh
```

Cron (`crontab -e`), todos los días a las 03:15 hora del servidor:

```cron
15 3 * * * AGE_RECIPIENTS_FILE=$HOME/.config/rideapp-backup/recipients.txt $HOME/bin/rideapp-backup.sh >> $HOME/backups/rideapp/backup.log 2>&1
```

Con copia fuera del VPS, añade `RCLONE_REMOTE=b2:rideapp-backups` (después de `rclone config`).

El usuario de `pg_dump` es `rideapp` (el de administración que creó Dokploy), no `rideapp_app`. Dentro del contenedor de Postgres se conecta por socket local.

## Prueba de restauración (una vez al mes)

```bash
scp admin@161.97.96.66:backups/rideapp/daily/rideapp-db-AAAAMMDD-HHMM.dump.age .
AGE_IDENTITY=~/rideapp-backup.key infra/backups/restore-test.sh rideapp-db-AAAAMMDD-HHMM.dump.age
```

Necesita Docker. No toca producción: crea un contenedor `postgis/postgis:17-3.5` temporal y lo borra al terminar.

## Restaurar de verdad (incidente)

1. Parar el API en Dokploy (para que no escriba durante la restauración).
2. Descifrar: `age -d -i rideapp-backup.key rideapp-db-….dump.age > rideapp.dump`.
3. Copiar al contenedor de Postgres y restaurar sobre una base vacía: `pg_restore -U rideapp -d rideapp --clean --if-exists --no-owner rideapp.dump`.
4. Documentos: `age -d -i rideapp-backup.key rideapp-files-….tar.age | docker exec -i <api> tar -C /app/var -xf -`.
5. Arrancar el API: `prisma migrate deploy` aplica lo que falte.

## Registro de pruebas

| Fecha      | Qué se probó                                                                                                                               | Resultado                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| 2026-10-02 | `backup.sh` contra el Postgres local (Docker) con `age` en un contenedor, retención con 8 copias antiguas, y `restore-test.sh` del volcado | OK: 8 migraciones, 15 usuarios, PostGIS responde |
