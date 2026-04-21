# Hello World — Python

from typing import Optional
import asyncio


def greet(name: str = "World") -> str:
    return f"Hello, {name}!"


names = ["Alice", "Bob", "Claude"]

for name in names:
    print(greet(name))


# Dataclass example
from dataclasses import dataclass

@dataclass
class Person:
    name: str
    age: int

    def introduce(self) -> str:
        return f"I'm {self.name}, {self.age} years old."


# Async example
async def fetch_greeting(url: str) -> Optional[str]:
    import urllib.request
    with urllib.request.urlopen(url) as resp:
        return resp.read().decode()


if __name__ == "__main__":
    p = Person("Claude", 1)
    print(p.introduce())
