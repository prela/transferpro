export function databaseIdentity(raw: string): {
  host: string
  port: string
  database: string
  user: string
  password: string
  sslmode: string | null
}
