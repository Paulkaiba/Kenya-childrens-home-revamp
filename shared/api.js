// The ONE place that says where the PHP API lives. Every page that talks to the database builds its URLs from here.
// The PHP code sits in the PHP/ folder at the project root (PHP/api/*.php). If you ever move it, change this line only.
export const apiUrl = name => `/PHP/Bakery/${name}`;   // shared/ and PHP/ are both at the project root
