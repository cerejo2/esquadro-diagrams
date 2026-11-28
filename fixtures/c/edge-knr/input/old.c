int twice(n)
  int n;
{
  return n + n;
}

int sum3(a, b, c)
  int a, b;
  int c;
{
  return a + b + twice(c);
}

int main(void)
{
  return sum3(1, 2, 3) - twice(3);
}
