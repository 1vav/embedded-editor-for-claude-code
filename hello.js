// Hello World — JavaScript

function greet(name = "World") {
  return `Hello, ${name}!`;
}

const names = ["Alice", "Bob", "Claude"];

for (const name of names) {
  console.log(greet(name));
}

// Arrow function
const double = (x) => x * 2;
console.log(double(21)); // 42

// Async example
async function fetchGreeting(url) {
  const res = await fetch(url);
  const data = await res.json();
  return data.greeting ?? "Hello!";
}
