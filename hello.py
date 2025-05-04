#!/usr/bin/env python3

def greet(name="World"):
    """
    A simple greeting function
    
    Args:
        name: The name to greet (default: "World")
    
    Returns:
        A greeting string
    """
    return f"Hello, {name}!"

if __name__ == "__main__":
    print(greet())
    print(greet("GitHub"))