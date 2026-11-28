export const createClient = () => ({ auth: { getUser: async () => ({data:{user:{id:'fixture'}}}) } });
