
import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

api_key = os.getenv("NVIDIA_API_KEY")

if not api_key:
    print("Error: NVIDIA_API_KEY not found in .env")
else:
    client = OpenAI(
        base_url="https://integrate.api.nvidia.com/v1",
        api_key=api_key
    )

    try:
        response = client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are Tessera, an AI study assistant. "
                        "Explain concepts clearly and help students "
                        "understand the reasons behind their mistakes."
                    )
                },
                {
                    "role": "user",
                    "content": (
                        "Explain the difference between population "
                        "and sample in simple words, with one example."
                    )
                }
            ],
            max_tokens=300
        )

        print("\nTessera says:\n")
        print(response.choices[0].message.content)

    except Exception as e:
        print("API request failed:", e)
