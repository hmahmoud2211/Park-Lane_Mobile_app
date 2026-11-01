// ParklaneDev.exe: a Windows launcher for scripts/dev.sh (see docs/SMART_HOME.md).
//
// Double-clicked, it shows a menu; with arguments, it passes them straight to the script:
//   ParklaneDev.exe local --web
//
// It runs the script with Git Bash, never with C:\Windows\System32\bash.exe (that one is WSL's
// Linux bash, which would not see the Windows Node.js). Build it with tools\launcher\build.cmd.
// Written for the C# 5 compiler that ships with Windows (.NET Framework 4).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;

internal static class ParklaneDev
{
    private static int Main(string[] args)
    {
        Console.Title = "Parklane smart home";
        bool fromMenu = args.Length == 0;

        string root = FindProjectRoot();
        if (root == null)
        {
            return Fail("Could not find scripts\\dev.sh. Put ParklaneDev.exe in the Park-Lane_Mobile_app folder.", fromMenu);
        }

        string bash = FindGitBash();
        if (bash == null)
        {
            return Fail("Git Bash was not found. Install Git for Windows from https://git-scm.com and try again.", fromMenu);
        }

        List<string> scriptArgs = fromMenu ? AskWhatToRun() : new List<string>(args);
        if (scriptArgs == null)
        {
            return 0;
        }

        // Ctrl+C belongs to the script, which stops what it started; the launcher just waits for it.
        Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e) { e.Cancel = true; };

        var start = new ProcessStartInfo
        {
            FileName = bash,
            Arguments = Quote("scripts/dev.sh") + " " + JoinQuoted(scriptArgs),
            WorkingDirectory = root,
            UseShellExecute = false,
        };

        int exitCode;
        try
        {
            using (Process process = Process.Start(start))
            {
                process.WaitForExit();
                exitCode = process.ExitCode;
            }
        }
        catch (Exception error)
        {
            return Fail("Could not start Git Bash: " + error.Message, fromMenu);
        }

        if (fromMenu)
        {
            Console.WriteLine();
            Console.WriteLine("Finished. Press Enter to close this window.");
            Console.ReadLine();
        }
        return exitCode;
    }

    private static List<string> AskWhatToRun()
    {
        Console.WriteLine();
        Console.WriteLine("  Parklane smart home");
        Console.WriteLine("  -------------------");
        Console.WriteLine("  1) Run with my real Home Assistant (Home Assistant + backend + app)");
        Console.WriteLine("  2) Run with the fake hub (no devices needed)");
        Console.WriteLine("  3) Connect Home Assistant to my account (first time only)");
        Console.WriteLine("  4) Run all checks");
        Console.WriteLine("  5) Quit");
        Console.WriteLine();

        while (true)
        {
            string choice = Ask("Choose 1-5: ");
            switch (choice)
            {
                case "1":
                    return WithAppOptions("local");
                case "2":
                    return WithAppOptions("fake");
                case "3":
                    return AskAttach();
                case "4":
                    return new List<string> { "check" };
                case "5":
                case null:
                    return null;
            }
            Console.WriteLine("  Please type a number from 1 to 5.");
        }
    }

    private static List<string> WithAppOptions(string mode)
    {
        var result = new List<string> { mode };
        string web = Ask("Open the app in the web browser? (Y/n): ");
        if (web == null || !web.Trim().StartsWith("n", StringComparison.OrdinalIgnoreCase))
        {
            result.Add("--web");
        }
        return result;
    }

    private static List<string> AskAttach()
    {
        Console.WriteLine();
        Console.WriteLine("  The backend must be running (option 1 in another window), and your EMS account");
        Console.WriteLine("  must exist (app: Settings > My Devices > Create account).");
        Console.WriteLine();
        string email = AskRequired("Your EMS account email: ");
        if (email == null)
        {
            return null;
        }
        string token = AskRequired("Home Assistant long-lived token: ");
        if (token == null)
        {
            return null;
        }
        return new List<string> { "attach", "--email", email.Trim(), "--token", token.Trim() };
    }

    private static string Ask(string prompt)
    {
        Console.Write("  " + prompt);
        string line = Console.ReadLine();
        return line == null ? null : line.Trim();
    }

    private static string AskRequired(string prompt)
    {
        while (true)
        {
            string value = Ask(prompt);
            if (value == null || value.Length > 0)
            {
                return value;
            }
        }
    }

    /// <summary>The folder holding scripts\dev.sh: next to the exe, or one of its parents.</summary>
    private static string FindProjectRoot()
    {
        var candidates = new List<string> { AppDomain.CurrentDomain.BaseDirectory, Environment.CurrentDirectory };
        foreach (string start in candidates)
        {
            DirectoryInfo dir = new DirectoryInfo(start);
            while (dir != null)
            {
                if (File.Exists(Path.Combine(dir.FullName, Path.Combine("scripts", "dev.sh"))))
                {
                    return dir.FullName;
                }
                dir = dir.Parent;
            }
        }
        return null;
    }

    /// <summary>Git for Windows' bash.exe, from the usual install folders or from git.exe on the PATH.</summary>
    private static string FindGitBash()
    {
        var candidates = new List<string>();
        foreach (string variable in new[] { "ProgramFiles", "ProgramW6432", "ProgramFiles(x86)" })
        {
            string folder = Environment.GetEnvironmentVariable(variable);
            if (!string.IsNullOrEmpty(folder))
            {
                candidates.Add(Path.Combine(folder, @"Git\bin\bash.exe"));
            }
        }
        string local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        if (!string.IsNullOrEmpty(local))
        {
            candidates.Add(Path.Combine(local, @"Programs\Git\bin\bash.exe"));
        }

        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string entry in path.Split(';'))
        {
            if (entry.Length == 0)
            {
                continue;
            }
            try
            {
                if (File.Exists(Path.Combine(entry, "git.exe")))
                {
                    // ...\Git\cmd\git.exe or ...\Git\mingw64\bin\git.exe → ...\Git\bin\bash.exe
                    DirectoryInfo dir = new DirectoryInfo(entry);
                    while (dir != null)
                    {
                        string bash = Path.Combine(dir.FullName, @"bin\bash.exe");
                        if (File.Exists(bash) && !IsWslBash(bash))
                        {
                            candidates.Add(bash);
                            break;
                        }
                        dir = dir.Parent;
                    }
                }
            }
            catch (ArgumentException)
            {
                // A malformed PATH entry; skip it.
            }
        }

        foreach (string candidate in candidates)
        {
            if (File.Exists(candidate) && !IsWslBash(candidate))
            {
                return candidate;
            }
        }
        return null;
    }

    private static bool IsWslBash(string path)
    {
        string system = Environment.GetFolderPath(Environment.SpecialFolder.System);
        return string.Equals(Path.GetDirectoryName(Path.GetFullPath(path)), system, StringComparison.OrdinalIgnoreCase);
    }

    private static string JoinQuoted(List<string> values)
    {
        var parts = new List<string>();
        foreach (string value in values)
        {
            parts.Add(Quote(value));
        }
        return string.Join(" ", parts.ToArray());
    }

    /// <summary>Quotes one argument for a Windows command line (the rules CommandLineToArgvW reads back).</summary>
    private static string Quote(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '"' }) < 0)
        {
            return value;
        }
        var result = new StringBuilder("\"");
        int backslashes = 0;
        foreach (char c in value)
        {
            if (c == '\\')
            {
                backslashes++;
                continue;
            }
            if (c == '"')
            {
                result.Append('\\', backslashes * 2 + 1);
            }
            else
            {
                result.Append('\\', backslashes);
            }
            backslashes = 0;
            result.Append(c);
        }
        result.Append('\\', backslashes * 2);
        result.Append('"');
        return result.ToString();
    }

    private static int Fail(string message, bool waitForEnter)
    {
        Console.ForegroundColor = ConsoleColor.Red;
        Console.WriteLine("  " + message);
        Console.ResetColor();
        if (waitForEnter)
        {
            Console.WriteLine("  Press Enter to close this window.");
            Console.ReadLine();
        }
        return 1;
    }
}
